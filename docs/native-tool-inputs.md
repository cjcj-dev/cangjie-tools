# Fixed inputs for cjlint and cjprof

Both native producers keep their public `build/build.py build|clean|install`
entry. Build now requires `--dependencies <file.json>` before the optional
`-- <CMake options>` separator. No implicit network branch selection remains.

The JSON object maps dependency names to `repo`, complete 40-character `commit`,
and absolute checkout `path`. cjlint needs `json`. cjprof needs `json`, `httplib`,
`runtime`, and `bounds`. The same JSON selection can serve both tools.

| Name | Source root consumed by CMake |
| --- | --- |
| json | `include/nlohmann/json.hpp` |
| httplib | `httplib.h` |
| runtime | `runtime/src/Demangler/CMakeLists.txt` |
| bounds | `include/securec.h` |

Use the caller's fixed repository tuple; this document does not choose a runtime
or upgrade SDK inputs. A missing path is initialized and fetches only the exact
selected commit. A warm checkout must be its own Git root with matching origin,
HEAD, and unchanged tracked source. A different/modified checkout is preserved
and reported; select an independent matching checkout rather than resetting an
active source. `repo` may be a local object mirror for offline materialization.
Materialized archives without Git metadata must be prepared through normal fixed
checkout first; a JSON claim alone does not establish their actual commit.

Resolved paths are passed into the real CMake graph. cjlint's `JSON_ROOT` is the
selected source and its compiler/version query uses `CANGJIE_HOME/bin`. cjprof's
`CJPROF_{JSON,HTTPLIB,RUNTIME,BOUNDS}_SOURCE` replace the former implicit
third_party layout; the Linux Demangler target is added directly from the
selected runtime source. Configuration runs on warm builds as well, so changed
inputs and build types are not hidden behind an existing build directory.

Typical caller commands, with its already prepared JSON and SDK environment:

```text
python3 cjlint/build/build.py build -t release --jobs 16 --dependencies /private/native-deps.json
python3 cjlint/build/build.py install --prefix /private/install/cjlint
python3 cjprof/build/build.py build -t release --jobs 16 --dependencies /private/native-deps.json
python3 cjprof/build/build.py install --prefix /private/install/cjprof
```

`--jobs` is a positive total for that producer, including its sequential JNI
child. The default comes from `CANGJIE_BUILD_JOBS`, otherwise actual affinity
(CPU count where affinity is unavailable). Parallel producers must divide the
caller's total allocation. JNI inherits environment, `JAVA_HOME`, parent jobs,
effective Debug/Release (coverage forces Debug), and target. Its link input is
the exact parent library, not a system search. Nonzero subprocess statuses reach
the public parent process; missing executables return failure too.

Install does not build. cjprof reads the actual native CMake build type/target,
then requires a matching JNI CMake cache, exact parent library selection, and
the expected platform library. Missing JNI output fails before native install
or copying old JNI dist. Native rebuild invalidates old JNI outputs, including
when `--skip-jni` selects a core-only build. Such a build cannot stand in for the
complete SDK producer; complete install requires a matching JNI build. JNI clean
also removes its own dist. Cross Windows headers are selected from the private
source's cross_win directory; no host JDK headers are edited.

Install payloads are cjlint `bin/cjlint`, `lib/libcjlint.*`, `config/*.json`;
cjprof `bin/cjprof`, `lib/libcjprof.*`, `lib/libcjprof-jni.*`, `config/static/**`.
JNI install does not produce a Java jar. `compile`/`run` remain separate JNI
commands. Shared libraries still need the SDK caller's normal target dependency
installation and launcher environment.

`tests/native-producers.mjs` is a resource-gated Linux producer integration test,
not a claim that an SDK/std is qualified. It invokes the real public build and
install commands with fixed dependencies, verifies warm Release/Debug selection,
rejects missing JNI despite old dist, and cuts a real JNI subprocess to check
exact parent rc37 with cjlint as an independent control before restoration.
Its CLI requires `--sdk`, `--dependencies`, `--work`, and `--jobs`. Running it
requires an independently admitted SDK, private source checkout, disk/CPU/memory
slot, and normal box/workflow entry; source review alone grants none of these.

cjprof coverage uses the normal `CJPROF_CODE_COVERAGE` CMake option. The public
producer writes ON with `--code-coverage` (forcing Debug), otherwise OFF on
**every** configure. Parent and JNI share the option implementation; its
instrumentation is appended in directory variables, never stored in the user's
`CMAKE_C_FLAGS`/`CMAKE_CXX_FLAGS` cache entries. The parent forwards its selected
cached compile/link flags, including configuration variants, into JNI. An
explicit Release C++ flag selection and executable linker flags are preserved.
JNI's standalone `build`/`all` accept the same coverage switch and compile/link
flag definitions after `--`; omit the switch for an ordinary build. JNI install
requires the matching coverage selection as well as the matching type/target.
Parent install obtains that selection from its native cache.

For a pre-option build directory, the public producer migrates only these exact
old generated values: C `-fprofile-arcs -ftest-coverage`, and C++
`-fprofile-arcs -ftest-coverage -DCOVERAGE_BUILD`. Each matching entry is unset
once before normal CMake initialization; other flag values and cache entries
stay intact. This also handles an old ordinary warm Release that retained the
coverage values. Current explicit `-- -DCMAKE_*_FLAGS=...` options apply after
migration; use them to retain an intentionally identical user selection.
Environment `CFLAGS`/`CXXFLAGS` initialize the reset entries normally. Values
already overwritten by the old producer cannot be reconstructed from its cache;
re-supply them through the normal environment or CMake arguments. No token
stripping or cache-wide deletion is used. Once the option exists, user flags
are left to normal CMake cache semantics, including deliberate instrumentation.

`tests/cjprof-coverage.mjs ABS/config.json` is a separate pending Linux gate for
this changed surface. Config requires absolute `sdk`, fixed `dependencies` JSON,
fresh `work`, positive `jobs`, and `control` (an absolute installed cjlint command
with real business arguments). Run in a fresh isolated source checkout only,
via the admitted box/workflow slot. It reproduces ec1ab's SOURCE finding with
the old real producer, restores candidate sources, then checks old-cache
migration and actual coverage -> ordinary Release -> cut -> restoration.
Generated native/JNI commands, caches, compile/link user flags, built artifacts,
normal install payloads, installed entry loading, exact target assertion failure,
and independent cjlint control are recorded. Entry loading is a finite install
check, not profiling business or SDK qualification. The old producer and option
cut temporarily replace only this private checkout's files; finally blocks
restore bytes. This script is supplied for resource/input admission; its
presence does not mean any arm has run. Existing unrelated gates stay unchanged.

cjlint and cjcompat collect the selected SDK's complete `cjc -v` stdout with
`cmake/CjcVersion.cmake`. The command is an argument vector without `bash -c`;
the selected SDK is explicit in `CANGJIE_HOME`. A nonzero child status or launch
failure is a configuration error even if stdout looks valid. Successful stderr
is reported as diagnostics and does not erase the version. Blank stdout fails.
CRLF and lone CR are normalized to LF, only trailing line terminators are
removed, and all version lines, spaces and tabs are otherwise preserved.

The result is escaped as a C++ string in a private generated `CjcVersion.h`,
included by the existing `PrintVersion` consumer in each tool. Version text is
not passed through command-line definitions or a generated Ninja file. The
header escapes backslashes, double quotes, LF and tabs; CMake's `@ONLY` template
does not substitute `${...}` present in compiler output. Both tools retain the
same version macro names and print the complete compiler version. The header is
an internal build input and adds no installed SDK payload or runtime dependency.

`tests/cjc-version.mjs ABS/config.json` is a separate finite native gate requiring
`{sdk:ABS,work:FRESH_ABS,jobs:2}`. Only run in an admitted private source tree via
box/workflow with the assigned resource limits. It executes the actual selected
SDK cjc for normal inputs, compiles the real CMake version calls and verbatim
PrintVersion bodies in a small harness with Ninja, and tests CRLF/string special
characters with an explicitly controlled boundary executable (Ninja and Unix
Makefiles). Nonzero/empty/missing producers fail and an independent executable
remains usable. A cut changes the production module's header value; the exact
consumer assertion must fail after a successful build, then recover after source
restoration. The original generated-header module is used, not a test re-creation
of its escaping algorithm. This finite harness does not build complete cjlint or
cjcompat and cannot replace the SDK owner's public producer/install/business
recovery. It does not modify a cjc launcher or generated build files.
