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
