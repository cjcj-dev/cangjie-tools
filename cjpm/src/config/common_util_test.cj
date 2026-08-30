// Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.
// This source file is part of the Cangjie project, licensed under Apache-2.0
// with Runtime Library Exception.
//
// See https://cangjie-lang.cn/pages/LICENSE for license information.

package cjpm.config

import std.collection.*
import std.unittest.*
import std.unittest.testmacro.*

const PIPE_DRAIN_FIXTURE: String = "test/fixtures/exec_with_output_helper.py"
const LARGE_STDERR_BYTES: Int64 = 204800
const SMALL_STDERR_BYTES: Int64 = 32768
const EXPECTED_STDOUT: String = "OUT-0001\nOUT-0002\n"

func assertExecWithOutputPreservesBothStreams(stderrBytes: Int64): Unit {
    let (success, outInfo, errInfo) = execWithOutput(
        "python3", ArrayList<String>([PIPE_DRAIN_FIXTURE, stderrBytes.toString()]))

    @Assert(success)
    @Assert(outInfo, EXPECTED_STDOUT)
    @Assert(errInfo.toArray().size, stderrBytes)
    for (byte in errInfo.toArray()) {
        @Assert(byte, UInt8(UInt32(r'E')))
    }
}

@Test
public func execWithOutputDrainsLargeStderrConcurrently(): Unit {
    assertExecWithOutputPreservesBothStreams(LARGE_STDERR_BYTES)
}

@Test
public func execWithOutputPreservesSmallStderr(): Unit {
    assertExecWithOutputPreservesBothStreams(SMALL_STDERR_BYTES)
}
