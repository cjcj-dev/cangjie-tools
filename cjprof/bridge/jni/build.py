#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Copyright (c) Huawei Technologies Co., Ltd. 2025-2026. All rights reserved.
# This source file is part of the Cangjie Project, licensed under Apache-2.0
# with Runtime Library Exception.
#
# See https://cangjie-lang.cn/pages/LICENSE for license information.

import argparse
import os
import sys
import shutil
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
BUILD_DIR = SCRIPT_DIR / "build"
JAVA_OUT = SCRIPT_DIR / "out"
DIST_DIR = SCRIPT_DIR / "dist"

RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
NC = '\033[0m'

LIBS = ["libcjprof-jni.so", "cjprof-jni.dll", "libcjprof-jni.dylib"]

def echo_info(msg):
    print(f"{GREEN}[INFO]{NC} {msg}")


def echo_warn(msg):
    print(f"{YELLOW}[WARN]{NC} {msg}")


def echo_error(msg):
    print(f"{RED}[ERROR]{NC} {msg}", file=sys.stderr)

def clean():
    echo_info("Cleaning build directories...")
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    if JAVA_OUT.exists():
        shutil.rmtree(JAVA_OUT)
    echo_info("Clean completed")


def build_jni(debug=False, target="native", jobs=1, prof_library=None):
    build_type = "Debug" if debug else "Release"
    echo_info(f"Building JNI library ({build_type})...")

    BUILD_DIR.mkdir(exist_ok=True)

    if not shutil.which("cmake"):
        echo_error("cmake not found")
        sys.exit(1)
    make_cmd = "mingw32-make" if sys.platform == "win32" else "make"
    if not shutil.which(make_cmd):
        echo_error(f"{make_cmd} not found")
        sys.exit(1)

    if prof_library is None:
        prof_library = default_prof_library(target)
    if not Path(prof_library).is_file():
        raise FileNotFoundError(f"Build the selected parent cjprof library first: {prof_library}")
    # Do not let an old installed JNI library survive a failed new build.
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    for lib in LIBS:
        (BUILD_DIR / lib).unlink(missing_ok=True)
    if target == "windows-x86_64":
        result = subprocess.run([
            "cmake",
            "-DCMAKE_BUILD_TYPE=" + build_type,
            "-DCMAKE_SYSTEM_NAME=" + "Windows",
            "-DCMAKE_C_COMPILER=" + "x86_64-w64-mingw32-gcc",
            "-DCMAKE_CXX_COMPILER=" + "x86_64-w64-mingw32-g++",
            "-DSTRIP_LIB_PREFIX=" + "ON",
            "..",
            "-DCJPROF_LIBRARY=" + str(Path(prof_library).resolve()),
            "-DCJPROF_TARGET=" + target,
            ], cwd=BUILD_DIR, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        echo_info(f"{result.stdout}")
        echo_info(f"{result.stderr}")
    else:
        cmake_args = ["cmake", "-DCMAKE_BUILD_TYPE=" + build_type, "..",
                      "-DCJPROF_LIBRARY=" + str(Path(prof_library).resolve()),
                      "-DCJPROF_TARGET=" + target]
        if sys.platform == "win32":
            cmake_args += ["-G", "MinGW Makefiles", "-DSTRIP_LIB_PREFIX=" + "ON"]
        subprocess.run(cmake_args, cwd=BUILD_DIR, check=True)
    subprocess.run(["cmake", "--build", str(BUILD_DIR), "--parallel", str(jobs)], check=True)
    echo_info("JNI library built successfully")


def compile_java():
    echo_info("Compiling Java sources...")

    JAVA_OUT.mkdir(exist_ok=True)

    if not shutil.which("javac"):
        echo_error("javac not found")
        sys.exit(1)

    java_model_dir = SCRIPT_DIR / "java" / "com" / "cjprof" / "jni" / "model"
    java_main_dir = SCRIPT_DIR / "java" / "com" / "cjprof" / "jni"

    model_files = [
        java_model_dir / "HeapSnapshot.java",
        java_model_dir / "BaseNode.java",
        java_model_dir / "InstanceNode.java",
        java_model_dir / "InstanceDiffNode.java",
        java_model_dir / "ConstructorNode.java",
        java_model_dir / "ConstructorDiffNode.java",
        java_model_dir / "Frame.java",
        java_model_dir / "ThreadInfo.java",
        java_main_dir / "CjprofException.java",
    ]
    subprocess.run(["javac", "-cp", "lombok-1.18.30.jar", "-d", str(JAVA_OUT)] + [str(f) for f in model_files], check=True)

    subprocess.run(
        ["javac", "-cp", str(JAVA_OUT), "-d", str(JAVA_OUT), str(java_main_dir / "Cjprof.java")],
        check=True
    )

    subprocess.run(
        ["javac", "-cp", str(JAVA_OUT), "-d", str(JAVA_OUT), str(java_main_dir / "CjprofDemo.java")],
        check=True
    )

    echo_info("Java compilation completed")


def run_demo():
    echo_info("Running CjprofDemo...")

    jni_lib_path = None

    for lib in LIBS:
        lib_path = BUILD_DIR / lib
        if lib_path.exists():
            jni_lib_path = str(BUILD_DIR)
            break

    if jni_lib_path is None:
        echo_error(f"JNI library not found in {BUILD_DIR}")
        if BUILD_DIR.exists():
            for f in BUILD_DIR.iterdir():
                print(f"  {f.name}")
        sys.exit(1)

    if sys.platform == "win32":
        env_path = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{jni_lib_path};{env_path}" if env_path else jni_lib_path
    else:
        env_path = os.environ.get("LD_LIBRARY_PATH", "")
        os.environ["LD_LIBRARY_PATH"] = f"{jni_lib_path}:{env_path}" if env_path else jni_lib_path

    subprocess.run(
        ["java", "-Djava.library.path=" + jni_lib_path, "-cp", str(JAVA_OUT), "com.cjprof.jni.CjprofDemo"],
        check=True
    )


def build_and_run():
    clean()
    build_jni()
    compile_java()
    run_demo()

def cached_value(key):
    with (BUILD_DIR / "CMakeCache.txt").open(encoding="utf-8") as cache:
        for line in cache:
            if line.startswith(key + ":"):
                return line.rstrip().split("=", 1)[1]
    raise ValueError(f"Missing {key} in JNI CMake cache; run build first")


def library_name(target="native"):
    if target == "windows-x86_64" or sys.platform == "win32":
        return "cjprof-jni.dll"
    return "libcjprof-jni.dylib" if sys.platform == "darwin" else "libcjprof-jni.so"


def default_prof_library(target):
    name = library_name(target).replace("-jni", "")
    return SCRIPT_DIR.parent.parent / "build" / "build" / "src" / name


def install(debug=False, target="native", prof_library=None):
    echo_info("Installing distribution files...")

    expected_type = "Debug" if debug else "Release"
    if cached_value("CMAKE_BUILD_TYPE") != expected_type or cached_value("CJPROF_TARGET") != target:
        raise ValueError("JNI configuration differs from install request; run matching build first")
    if Path(cached_value("CJPROF_LIBRARY")).resolve() != Path(prof_library or default_prof_library(target)).resolve():
        raise ValueError("JNI parent library differs from selected native producer")
    name = library_name(target)
    source = BUILD_DIR / name
    if not source.is_file():
        raise FileNotFoundError(f"Missing built JNI library: {source}; install never builds implicitly")

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(exist_ok=True)

    shutil.copy2(source, DIST_DIR / name)
    echo_info(f"  Copied {name}")

    echo_info(f"Installation completed: {DIST_DIR}")
    echo_info("")
    echo_info("Distribution contents:")
    for f in DIST_DIR.iterdir():
        if f.is_dir():
            echo_info(f"  {f.name}/")
            for sub in f.iterdir():
                echo_info(f"    {sub.name}")
        else:
            echo_info(f"  {f.name}")

def usage():
    print("Usage: python build.py [command] [-t debug|release]")
    print("")
    print("Commands:")
    print("  clean          Clean build directories")
    print("  build          Build JNI library only")
    print("  compile        Compile Java sources only")
    print("  run            Run demo (requires build first)")
    print("  install        Create distribution package")
    print("")
    print("Options:")
    print("  -t debug       Build in debug mode (only for build/all)")
    print("  -t release     Build in release mode (default)")
    print("")
    print("Examples:")
    print("  python build.py                      # Build and run (release)")
    print("  python build.py build                # Build JNI library only (release)")
    print("  python build.py build -t debug       # Build JNI library (debug)")
    print("  python build.py install             # Create distribution package")

def main():
    parser = argparse.ArgumentParser(description="Build/install the cjprof JNI bridge")
    parser.add_argument("command", nargs="?", default="all",
                        choices=["all", "build", "install", "clean", "compile", "run"])
    parser.add_argument("-t", "--build-type", choices=["debug", "release"], default="release")
    parser.add_argument("--target", choices=["native", "windows-x86_64"], default="native")
    parser.add_argument("-j", "--jobs", type=positive_jobs,
                        default=os.environ.get("CANGJIE_BUILD_JOBS") or
                        (len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count() or 1))
    parser.add_argument("--prof-library", help="Exact built parent library")
    args = parser.parse_args()
    cmd, debug, target = args.command, args.build_type == "debug", args.target
    if cmd == "all":
        def build_and_run_with_release():
            clean()
            build_jni(debug, target, args.jobs, args.prof_library)
            compile_java()
            run_demo()
        build_and_run_with_release()
    elif cmd == "build":
        build_jni(debug, target, args.jobs, args.prof_library)
    elif cmd == "install":
        install(debug, target, args.prof_library)
    elif cmd == "clean":
        clean()
    elif cmd == "compile":
        compile_java()
    elif cmd == "run":
        run_demo()
    else:
        usage()
        sys.exit(1)


def positive_jobs(value):
    jobs = int(value)
    if jobs < 1:
        raise argparse.ArgumentTypeError("jobs must be positive")
    return jobs


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode if error.returncode > 0 else 128 - error.returncode)
    except (OSError, ValueError) as error:
        echo_error(str(error))
        sys.exit(1)
