// Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.
// This source file is part of the Cangjie project, licensed under Apache-2.0
// with Runtime Library Exception.
// See https://cangjie-lang.cn/pages/LICENSE for license information.

package cjpm.config

import std.collection.*
import std.fs.*
import std.unittest.*
import std.unittest.testmacro.*

// Write more than a pipe can hold to each stream, in opposite stream order.
const PUBLICATION_PIPE_BYTES: Int64 = 262144
const PUBLICATION_PIPE_PROGRAM: String =
    "import os,sys; n=int(sys.argv[1]); assert sys.platform!='linux' or n>__import__('fcntl').fcntl(1,__import__('fcntl').F_GETPIPE_SZ); assert sys.platform!='linux' or n>__import__('fcntl').fcntl(2,__import__('fcntl').F_GETPIPE_SZ); os.write(2,b'E'*n); os.write(1,b'O'*n); sys.exit(int(sys.argv[2]))"

func assertPublicationPipeResult(success: Bool, outInfo: String, errInfo: String, expectedSuccess: Bool): Unit {
    @Assert(success, expectedSuccess)
    @Assert(outInfo.toArray().size, PUBLICATION_PIPE_BYTES)
    @Assert(errInfo.toArray().size, PUBLICATION_PIPE_BYTES)
    @Assert(outInfo, String.fromUtf8(Array<UInt8>(PUBLICATION_PIPE_BYTES, repeat: UInt8(UInt32(r'O')))))
    @Assert(errInfo, String.fromUtf8(Array<UInt8>(PUBLICATION_PIPE_BYTES, repeat: UInt8(UInt32(r'E')))))
}

@Test
public func execWithOutputPreservesTwoLargeStreams(): Unit {
    let (success, outInfo, errInfo) = execWithOutput("python3",
        ArrayList<String>(["-c", PUBLICATION_PIPE_PROGRAM, PUBLICATION_PIPE_BYTES.toString(), "0"]))
    assertPublicationPipeResult(success, outInfo, errInfo, true)
}

@Test
public func execWithOutputPreservesNonzeroExitAndLargeStreams(): Unit {
    let (success, outInfo, errInfo) = execWithOutput("python3",
        ArrayList<String>(["-c", PUBLICATION_PIPE_PROGRAM, PUBLICATION_PIPE_BYTES.toString(), "23"]))
    assertPublicationPipeResult(success, outInfo, errInfo, false)
}

@Test
public func execWithOutputPreservesScriptEnvironmentAndWorkingDirectory(): Unit {
    let env = HashMap<String, String>()
    env.add("CJPM_PUBLICATION_PIPE_CONTROL", "present")
    let program = "import os,sys; assert os.environ['CJPM_PUBLICATION_PIPE_CONTROL']=='present'; assert os.path.isfile('exec_with_output_helper.py'); " +
        PUBLICATION_PIPE_PROGRAM
    let (success, outInfo, errInfo) = execWithOutput("python3",
        ArrayList<String>(["-c", program, PUBLICATION_PIPE_BYTES.toString(), "0"]),
        envMap: env, workingDirectory: Path("test/fixtures"), spawnForScript: true)
    assertPublicationPipeResult(success, outInfo, errInfo, true)
}

@Test
public func execWithOutputPreservesStdoutOnlyControl(): Unit {
    let (success, outInfo, errInfo) = execWithOutput("python3",
        ArrayList<String>(["-c", "import os; os.write(1,b'CONTROL')"]))
    @Assert(success)
    @Assert(outInfo, "CONTROL")
    @Assert(errInfo, "")
}

@Test
public func execWithOutputReportsLaunchFailure(): Unit {
    let (success, outInfo, errInfo) = execWithOutput("/nonexistent-cjpm-publication-command", ArrayList<String>())
    @Assert(!success)
    @Assert(outInfo, "")
    @Assert(errInfo, "")
}
