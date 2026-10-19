# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.
# Licensed under Apache-2.0 with Runtime Library Exception.

option(CJPROF_CODE_COVERAGE "Build cjprof and JNI with gcov instrumentation" OFF)
if(CJPROF_CODE_COVERAGE)
    # Normal directory variables: never overwrite user cache flags. CMake uses
    # these flags for both compilation and linking the coverage runtime.
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fprofile-arcs -ftest-coverage")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fprofile-arcs -ftest-coverage -DCOVERAGE_BUILD")
endif()
