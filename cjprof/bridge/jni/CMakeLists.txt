# Copyright (c) Huawei Technologies Co., Ltd. 2025-2026. All rights reserved.
# This source file is part of the Cangjie project, licensed under Apache-2.0
# with Runtime Library Exception.
#
# See https://cangjie-lang.cn/pages/LICENSE for license information.

cmake_minimum_required(VERSION 3.10)
project(cjprof-jni)
include(../../cmake/Coverage.cmake)
set(CJPROF_TARGET "native" CACHE STRING "Selected producer target")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(STRIP_LIB_PREFIX "Strip 'lib' prefix" OFF)

if (STRIP_LIB_PREFIX)
    set(CMAKE_SHARED_LIBRARY_PREFIX "")
endif()

set(JAVA_AWT_LIBRARY "NotNeeded")
set(JAVA_JVM_LIBRARY "NotNeeded")
set(JAVA_AWT_INCLUDE_PATH "NotNeeded")
find_package(JNI REQUIRED)
message(STATUS "Found JNI: ${JNI_INCLUDE_DIRS}")

include_directories(${JNI_INCLUDE_DIRS})
if(WIN32 AND NOT CMAKE_HOST_WIN32)
    include_directories(BEFORE "${CMAKE_SOURCE_DIR}/cross_win")
endif()
include_directories(${CMAKE_SOURCE_DIR})
include_directories(../../include)

add_library(cjprof-jni SHARED
    cpp/CjprofJNI.cpp
)

if (CMAKE_BUILD_TYPE MATCHES Release AND MINGW)
    target_link_options(cjprof-jni PRIVATE -static -Wl,--no-insert-timestamp -Wl,--allow-multiple-definition)
endif ()

if (NOT APPLE AND NOT WIN32 AND CMAKE_BUILD_TYPE MATCHES Release)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fstack-protector-all -ftrapv -fPIE")
    set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -s -Wl,-z,relro,-z,now,-z,noexecstack -Wl,-Bsymbolic -rdynamic -Wl,--no-undefined")
    set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -s -Wl,-z,relro,-z,now,-z,noexecstack -Wl,-Bsymbolic -rdynamic -Wl,--no-undefined")
    SET(CMAKE_SKIP_RPATH TRUE)
    SET(CMAKE_SKIP_BUILD_RPATH TRUE)
endif ()

set_target_properties(cjprof-jni PROPERTIES
    OUTPUT_NAME "cjprof-jni"
)

if(IS_ABSOLUTE "${CJPROF_LIBRARY}" AND EXISTS "${CJPROF_LIBRARY}")
    target_link_libraries(cjprof-jni ${CJPROF_LIBRARY})
else()
    message(FATAL_ERROR "CJPROF_LIBRARY must be the exact built parent library")
endif()
