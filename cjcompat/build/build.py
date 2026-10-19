#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# Copyright (c) Huawei Technologies Co., Ltd. 2025. All rights reserved.
# This source file is part of the Cangjie project, licensed under Apache-2.0
# with Runtime Library Exception.
#
# See https://cangjie-lang.cn/pages/LICENSE for license information.

"""Build the fixed cjcompat producer against a selected installed SDK."""
import argparse
import re
import logging
import multiprocessing
import os
import platform
import shutil
import subprocess
import sys
from enum import Enum
from logging.handlers import TimedRotatingFileHandler
from subprocess import PIPE

THREADS_NUM = os.environ.get("CANGJIE_BUILD_JOBS") or (
    len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else multiprocessing.cpu_count())
FAIL_CASE_NUM = 0
PASS_CASE_NUM = 0

BUILD_DIR = os.path.dirname(os.path.abspath(__file__))
HOME_DIR = os.path.dirname(BUILD_DIR)
EXECUTE_DIR = os.path.join(BUILD_DIR, "build", "bin")
THIRDPARTY_DIR = os.path.join(HOME_DIR, "third_party")
CMAKE_BUILD_DIR = os.path.join(BUILD_DIR, "build")
CMAKE_OUTPUT_DIR = os.path.join(HOME_DIR, "dist")
OUTPUT_BIN_DIR = os.path.join(CMAKE_OUTPUT_DIR, "bin")
LOG_DIR = os.path.join(BUILD_DIR, "logs")
LOG_FILE = os.path.join(LOG_DIR, "cjcompat.log")

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"
ARCH_NAME = (
    platform.machine().replace("AMD64", "x86_64").replace("arm64", "aarch64").lower()
)
CAN_RUN_MAPLE = platform.system() == "Linux" and platform.machine() == "x86_64"


def positive_jobs(value):
    jobs = int(value)
    if jobs < 1:
        raise argparse.ArgumentTypeError("jobs must be positive")
    return jobs

def check_compiler(args):
    # use llvm toolchain on linux
    if not IS_WINDOWS:
        clang_path = shutil.which("clang")
        clang_pp_path = shutil.which("clang++")
        if not clang_path:
            raise FileNotFoundError("clang is required to build cjcompat")
        if not clang_pp_path:
            raise FileNotFoundError("clang++ is required to build cjcompat")

        if args.gcc_toolchain:
            clang_path += " --gcc-toolchain={}".format(args.gcc_toolchain)
            clang_pp_path += " --gcc-toolchain={}".format(args.gcc_toolchain)

        os.environ["CC"] = clang_path
        os.environ["CXX"] = clang_pp_path
    else:
        c_compiler = shutil.which("gcc")
        cxx_compiler = shutil.which("g++")
        if not c_compiler:
            raise FileNotFoundError("gcc is required to build cjcompat")
        if not cxx_compiler:
            raise FileNotFoundError("g++ is required to build cjcompat")
        os.environ["CC"] = c_compiler
        os.environ["CXX"] = cxx_compiler


def log_output(output):
    """log command output"""
    while True:
        line = output.stdout.readline()
        if not line:
            output.communicate()
            returncode = output.returncode
            if returncode != 0:
                LOG.error("build error: %d!\n", returncode)
                sys.exit(returncode if returncode > 0 else 128 - returncode)
            break
        try:
            LOG.info(line.decode("ascii", "ignore").rstrip())
        except UnicodeEncodeError:
            LOG.info(line.decode("utf-8", "ignore").rstrip())


def init_log(name):
    """init log config"""
    if not os.path.exists(LOG_DIR):
        os.makedirs(LOG_DIR)

    log = logging.getLogger(name)
    log.setLevel(logging.DEBUG)
    formatter = logging.Formatter(
        "[%(asctime)s:%(module)s:%(lineno)s:%(levelname)s] %(message)s"
    )
    streamhandler = logging.StreamHandler(sys.stdout)
    streamhandler.setLevel(logging.DEBUG)
    streamhandler.setFormatter(formatter)
    log.addHandler(streamhandler)
    filehandler = TimedRotatingFileHandler(
        LOG_FILE, when="W6", interval=1, backupCount=60
    )
    filehandler.setLevel(logging.DEBUG)
    filehandler.setFormatter(formatter)
    log.addHandler(filehandler)
    return log


def generate_cmake_defs(args):
    """convert args to cmake defs"""

    def bool_to_opt(value):
        return "ON" if value else "OFF"

    if args.target == "windows-x86_64":
        return [
            "-DCMAKE_BUILD_TYPE=" + args.build_type.value,
            "-DCOVERAGE_FLAG=" + bool_to_opt(args.code_coverage),
            "-DCMAKE_SYSTEM_NAME=" + "Windows",
            "-DCMAKE_C_COMPILER=" + "x86_64-w64-mingw32-gcc",
            "-DCMAKE_CXX_COMPILER=" + "x86_64-w64-mingw32-g++",
        ] + [arg for arg in args.cmake_args if arg != "--"] + ["-DCANGJIE_HOME=" + args.sdk]

    return [
        "-DCMAKE_BUILD_TYPE=" + args.build_type.value,
        "-DCOVERAGE_FLAG=" + bool_to_opt(args.code_coverage),
    ] + [arg for arg in args.cmake_args if arg != "--"] + ["-DCANGJIE_HOME=" + args.sdk]


def build(args):
    if args.build_type is None:
        LOG.error(
            "please specify the build type. Supported options are: release and debug."
        )
        raise ValueError("build type is required")

    check_compiler(args)
    sdk = args.sdk or os.environ.get("CANGJIE_HOME")
    if not sdk:
        raise ValueError("select the installed SDK with --sdk or CANGJIE_HOME")
    args.sdk = os.path.realpath(sdk)
    os.environ["CANGJIE_HOME"] = args.sdk
    if any(re.match(r"-D(CMAKE_BUILD_TYPE|CANGJIE_HOME)(:[^=]+)?=", arg) for arg in args.cmake_args):
        raise ValueError("select build type with -t and SDK with --sdk, not a CMake override")
    """cjcompat build"""
    LOG.info("begin build...\n")

    os.makedirs(CMAKE_BUILD_DIR, exist_ok=True)
    generator = "MinGW Makefiles" if IS_WINDOWS else ("Unix Makefiles" if args.target == "windows-x86_64" else "Ninja")
    output = subprocess.Popen(["cmake", HOME_DIR, "-G", generator] + generate_cmake_defs(args),
                              cwd=CMAKE_BUILD_DIR, stdout=PIPE)
    log_output(output)
    output = subprocess.Popen(["cmake", "--build", CMAKE_BUILD_DIR, "--parallel", str(args.jobs)], stdout=PIPE)
    log_output(output)
    LOG.info("end build\n")



def clean(args):
    """clean build outputs and logs"""
    LOG.info("begin clean...\n")
    output_dirs = [
        "build/build", "dist"
    ]
    for file_path in output_dirs:
        abs_file_path = os.path.join(HOME_DIR, file_path)
        if os.path.isdir(abs_file_path):
            shutil.rmtree(abs_file_path, ignore_errors=True)
        if os.path.isfile(abs_file_path):
            os.remove(abs_file_path)
    LOG.info("end clean\n")


def install(args):
    """install targets"""
    LOG.info("begin install targets...")
    install_path = os.path.abspath(args.install_prefix) if args.install_prefix else CMAKE_OUTPUT_DIR
    output = subprocess.Popen(
        ["cmake", "--install", "build", "--prefix", install_path],
        cwd=BUILD_DIR,
        stdout=PIPE,
    )
    log_output(output)
    if output.returncode != 0:
        LOG.fatal("install failed")

    LOG.info("end install targets...")


class BuildType(Enum):
    """CMAKE_BUILD_TYPE options"""

    debug = "Debug"
    release = "Release"

    def __str__(self):
        return self.name

    def __repr__(self):
        return str(self)

    @staticmethod
    def argparse(s):
        try:
            return BuildType[s]
        except KeyError:
            return s


def main():
    """build entry"""
    parser = argparse.ArgumentParser(description="build cjcompat project")
    subparsers = parser.add_subparsers(help="sub command help")
    parser_build = subparsers.add_parser("build", help="build cjcompat")
    parser_build.add_argument(
        "-t",
        "--build-type",
        type=BuildType.argparse,
        dest="build_type",
        default=None,
        choices=list(BuildType),
        help="select target build type",
    )
    parser_build.add_argument(
        "--code-coverage", action="store_true", help="do code coverage"
    )

    parser_build.add_argument(
        "--gcc-toolchain", dest="gcc_toolchain", help="Specify toolchain for cjcompat build"
    )

    parser_build.add_argument(
        "--target",
        type=str,
        dest="target",
        default="native",
        choices=["native", "windows-x86_64"],
        help="Specify the target platform (default: native).",
    )
    parser_build.add_argument(
        "-j",
        "--jobs",
        type=positive_jobs,
        default=THREADS_NUM,
        help="number of parallel jobs to run")
    parser_build.add_argument(
        "cmake_args",
        nargs=argparse.REMAINDER,
        help="other arguments directly passed to CMake, " "please pass it after a '--'",
    )
    parser_build.add_argument("--sdk", help="installed SDK (otherwise explicit CANGJIE_HOME)")
    parser_build.set_defaults(func=build)

    parser_install = subparsers.add_parser("install", help="install targets")
    parser_install.add_argument(
        "--prefix", dest="install_prefix", help="target install prefix"
    )
    parser_install.set_defaults(func=install)

    parser_clean = subparsers.add_parser("clean", help="clean build")
    parser_clean.set_defaults(func=clean)

    args = parser.parse_args()
    if not hasattr(args, "func"):
        args = parser.parse_args(["build"] + sys.argv[1:])

    args.func(args)
    if FAIL_CASE_NUM != 0:
        exit(1)


if __name__ == "__main__":
    LOG = init_log("root")
    os.environ["LANG"] = "C.UTF-8"
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode if error.returncode > 0 else 128 - error.returncode)
    except (OSError, ValueError, KeyError) as error:
        LOG.error("%s", error)
        sys.exit(1)
