// Copyright (c) Huawei Technologies Co., Ltd. 2025. All rights reserved.
// This source file is part of the Cangjie project, licensed under Apache-2.0
// with Runtime Library Exception.
//
// See https://cangjie-lang.cn/pages/LICENSE for license information.

package cjpm.implement

import std.collection.*
import std.env.{getTempDirectory, getVariable}
import std.fs.*
import std.sync.*
import std.time.*

import cjpm.config.EnvironmentBuilder

private let JOBSERVER_OPEN_READ_WRITE: Int32 = 2
@When[os == "Linux"]
private let JOBSERVER_OPEN_NONBLOCK: Int32 = 0x800
@When[os == "macOS" || os == "iOS"]
private let JOBSERVER_OPEN_NONBLOCK: Int32 = 0x4
private let JOBSERVER_FIFO_MODE: UInt32 = 0x180u32
private let JOBSERVER_TOKEN: UInt8 = b'+'

@When[os == "Linux" || os == "macOS" || os == "iOS"]
foreign {
    func mkfifo(path: CString, mode: UInt32): Int32
    func open(path: CString, flags: Int32, ...): Int32
    func read(fd: Int32, buffer: CPointer<Unit>, count: UIntNative): IntNative
    func write(fd: Int32, buffer: CPointer<Unit>, count: UIntNative): IntNative
    func close(fd: Int32): Int32
}

private var activeJobserver: ?Jobserver = None
private let activeJobserverMutex = Mutex()

class JobserverPermit {
    private let owner: Jobserver
    private let implicit: Bool
    private let token: UInt8
    private var released: Bool = false

    JobserverPermit(owner: Jobserver, implicit: Bool, token!: UInt8 = JOBSERVER_TOKEN) {
        this.owner = owner
        this.implicit = implicit
        this.token = token
    }

    func release(): Unit {
        if (released) {
            return
        }
        released = true
        owner.release(implicit, token)
    }
}

class Jobserver {
    private let mutex = Mutex()
    private let fifoDirectory: Path
    private let fifoPath: Path
    private let fd: Int32
    private let initialTokenCount: Int64
    private var implicitHeld: Bool = false
    private var activeCount: Int64 = 0
    private var peakActiveCount: Int64 = 0
    private var closed: Bool = false

    Jobserver(fifoDirectory: Path, fifoPath: Path, fd: Int32, initialTokenCount: Int64) {
        this.fifoDirectory = fifoDirectory
        this.fifoPath = fifoPath
        this.fd = fd
        this.initialTokenCount = initialTokenCount
    }

    func authFlags(): String {
        return "--jobserver-auth=fifo:${fifoPath.toString()} -j${initialTokenCount + 1}"
    }

    func acquire(): JobserverPermit {
        while (true) {
            synchronized(mutex) {
                if (!implicitHeld) {
                    implicitHeld = true
                    recordAcquire()
                    return JobserverPermit(this, true)
                }
                if (let Some(token) <- tryReadToken()) {
                    recordAcquire()
                    return JobserverPermit(this, false, token: token)
                }
            }
            sleep(200 * Duration.microsecond)
        }
        throw Exception("unreachable jobserver acquire")
    }

    private func recordAcquire(): Unit {
        activeCount++
        if (activeCount > peakActiveCount) {
            peakActiveCount = activeCount
        }
    }

    func release(implicit: Bool, token: UInt8): Unit {
        synchronized(mutex) {
            if (implicit) {
                implicitHeld = false
            } else {
                writeToken(token)
            }
            if (activeCount > 0) {
                activeCount--
            }
        }
    }

    func finishBuild(): Unit {
        var returnedTokens: Int64 = 0
        var restoredTokens: Int64 = 0
        synchronized(mutex) {
            while (let Some(_) <- tryReadToken()) {
                returnedTokens++
            }
            restoredTokens = if (returnedTokens < initialTokenCount) {
                initialTokenCount - returnedTokens
            } else {
                0
            }
            var count: Int64 = 0
            while (count < initialTokenCount) {
                writeToken(JOBSERVER_TOKEN)
                count++
            }
            if ((getVariable("CJPM_JOBSERVER_TRACE") ?? "") == "1") {
                println("CJPM_JOBSERVER tokens initial=${initialTokenCount} returned=${returnedTokens} " +
                    "restored=${restoredTokens} active=${activeCount} peak=${peakActiveCount}")
            }
        }
    }

    func closeServer(): Unit {
        synchronized(mutex) {
            if (closed) {
                return
            }
            closed = true
            closeDescriptor()
        }
        if (exists(fifoDirectory)) {
            remove(fifoDirectory, recursive: true)
        }
    }

    @When[os == "Linux" || os == "macOS" || os == "iOS"]
    private func tryReadToken(): ?UInt8 {
        try (token = LibC.malloc<UInt8>().asResource()) {
            if (token.value.isNull()) {
                return None
            }
            if (unsafe { read(fd, CPointer<Unit>(token.value), UIntNative(1)) } == 1) {
                return Some(unsafe { token.value.read() })
            }
        }
        return None
    }

    @When[os == "Windows" || env == "ohos" || env == "android"]
    private func tryReadToken(): ?UInt8 { None }

    @When[os == "Linux" || os == "macOS" || os == "iOS"]
    private func writeToken(tokenValue: UInt8): Unit {
        try (token = LibC.malloc<UInt8>().asResource()) {
            if (!token.value.isNull()) {
                unsafe {
                    token.value.write(tokenValue)
                    let _ = write(fd, CPointer<Unit>(token.value), UIntNative(1))
                }
            }
        }
    }

    @When[os == "Windows" || env == "ohos" || env == "android"]
    private func writeToken(_: UInt8): Unit {}

    @When[os == "Linux" || os == "macOS" || os == "iOS"]
    private func closeDescriptor(): Unit {
        let _ = unsafe { close(fd) }
    }

    @When[os == "Windows" || env == "ohos" || env == "android"]
    private func closeDescriptor(): Unit {}
}

@When[os == "Linux" || os == "macOS" || os == "iOS"]
func createJobserver(maxJobs: Int64): ?Jobserver {
    if ((getVariable("CJPM_JOBSERVER") ?? "") != "1") {
        return None
    }
    let tokenCount = if (maxJobs > 1) { maxJobs - 1 } else { 0 }
    let directory = Directory.createTemp(getTempDirectory())
    let path = directory.join("jobserver.fifo")
    var descriptor: Int32 = -1
    try (nativePath = unsafe { LibC.mallocCString(path.toString()) }.asResource()) {
        if (nativePath.value.isNull() || unsafe { mkfifo(nativePath.value, JOBSERVER_FIFO_MODE) } != 0) {
            remove(directory, recursive: true)
            eprintln("warning: failed to create GNU jobserver FIFO; using legacy cjpm concurrency")
            return None
        }
        descriptor = unsafe { open(nativePath.value, JOBSERVER_OPEN_READ_WRITE | JOBSERVER_OPEN_NONBLOCK) }
    }
    if (descriptor < 0) {
        remove(directory, recursive: true)
        eprintln("warning: failed to open GNU jobserver FIFO; using legacy cjpm concurrency")
        return None
    }
    let server = Jobserver(directory, path, descriptor, tokenCount)
    var count: Int64 = 0
    while (count < tokenCount) {
        server.release(false, JOBSERVER_TOKEN)
        count++
    }
    synchronized(activeJobserverMutex) {
        activeJobserver = Some(server)
    }
    return Some(server)
}

@When[os == "Windows" || env == "ohos" || env == "android"]
func createJobserver(_: Int64): ?Jobserver {
    if ((getVariable("CJPM_JOBSERVER") ?? "") == "1") {
        eprintln("warning: GNU FIFO jobserver is unavailable on this platform; using legacy cjpm concurrency")
    }
    return None
}

func configureJobserverEnvironment(envBuilder: EnvironmentBuilder): Unit {
    synchronized(activeJobserverMutex) {
        if (let Some(server) <- activeJobserver) {
            let flags = server.authFlags()
            envBuilder.replace("CJPM_JOBSERVER", "1")
            envBuilder.replace("CARGO_MAKEFLAGS", flags)
            envBuilder.replace("MAKEFLAGS", flags)
            envBuilder.replace("MFLAGS", flags)
        }
    }
}

func finishJobserver(server: Jobserver): Unit {
    server.finishBuild()
    synchronized(activeJobserverMutex) {
        activeJobserver = None
    }
    server.closeServer()
}
