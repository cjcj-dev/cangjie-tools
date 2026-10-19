# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.
# Licensed under Apache-2.0 with Runtime Library Exception.

set(CANGJIE_CJC_VERSION_TEMPLATE "${CMAKE_CURRENT_LIST_DIR}/CjcVersion.h.in")

# Keep version text out of command-line definitions: a generated header only
# crosses C++ string parsing, never CMake-list, shell or Ninja argument parsing.
function(cangjie_cjc_version_header output macro)
    if(CMAKE_HOST_WIN32)
        set(cjc "${CANGJIE_HOME}/bin/cjc.exe")
    else()
        set(cjc "${CANGJIE_HOME}/bin/cjc")
    endif()
    execute_process(COMMAND "${CMAKE_COMMAND}" -E env "CANGJIE_HOME=${CANGJIE_HOME}"
        "${cjc}" -v
        RESULT_VARIABLE version_rc OUTPUT_VARIABLE version ERROR_VARIABLE diagnostics)
    if(NOT "${version_rc}" STREQUAL "0")
        message(FATAL_ERROR "Selected SDK cjc -v failed (${version_rc}): ${diagnostics}")
    endif()
    # stderr may contain successful compiler warnings; it is not an exit code.
    if(NOT "${diagnostics}" STREQUAL "")
        message(STATUS "Selected SDK cjc -v stderr: ${diagnostics}")
    endif()
    string(REPLACE "\r\n" "\n" version "${version}")
    string(REPLACE "\r" "\n" version "${version}")
    string(REGEX REPLACE "\n+$" "" version "${version}")
    string(STRIP "${version}" nonblank_version)
    if("${nonblank_version}" STREQUAL "")
        message(FATAL_ERROR "Selected SDK cjc -v returned empty version output")
    endif()
    string(REPLACE "\\" "\\\\" CJC_VERSION_ESCAPED "${version}")
    string(REPLACE "\"" "\\\"" CJC_VERSION_ESCAPED "${CJC_VERSION_ESCAPED}")
    string(REPLACE "\n" "\\n" CJC_VERSION_ESCAPED "${CJC_VERSION_ESCAPED}")
    string(REPLACE "\t" "\\t" CJC_VERSION_ESCAPED "${CJC_VERSION_ESCAPED}")
    set(CJC_VERSION_MACRO "${macro}")
    configure_file("${CANGJIE_CJC_VERSION_TEMPLATE}" "${output}" @ONLY)
endfunction()
