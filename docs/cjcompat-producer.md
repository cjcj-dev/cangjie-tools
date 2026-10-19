# Fixed historical cjcompat producer

This directory imports the complete producer from tools commit
`41a1222dbe0660b28a3e005b429de7b3fa5697a2` (cjcompat tree
`16ed76f8990534ba78dad2bf9e738d323d7b42af`). It is a historical source selection;
it does not identify the source of an existing official nightly executable.
All rule implementations, rule ordering, API/ABI options, CJO loading, diffing,
logging, licensing and architecture documentation are retained. The upstream
bulk shell helper is migrated to `cjcompat/build/cjcompat_check_libs.mjs`.

The alternative `d5ef28a1db3be74c1c30a1d56251b2f1889dcb81` has identical rule and
checker lists. Its additional function-body reference traversal computes sets
that its resulting predicate does not use. This selection keeps 41a's initialized
`NodeInfo.diff`, warning flags and unused-parameter handling, and avoids that
additional traversal. It retains 41a's public compatibility result convention:
`Compatible!` or `Incompatible!`, with successful comparison returning zero in
both cases. Loading/argument failures return nonzero. Consumers must inspect the
actual compatibility result, not interpret zero alone as compatibility.

## Build and install interface

From the selected tools checkout, with a qualified SDK, native compiler/CMake/Ninja:

```
python3 cjcompat/build/build.py build -t release --jobs N --sdk /absolute/selected-sdk
python3 cjcompat/build/build.py install --prefix /absolute/component-prefix
```

`--sdk` defaults only to the explicitly provided `CANGJIE_HOME`. There is no
compiler source path guess, compiler output lookup, network dependency, or
implicit compiler build/install. Release/debug use `-t`; every build reconfigures
CMake, including warm builds. `--jobs` is positive; the default is
`CANGJIE_BUILD_JOBS`, process affinity, then CPU count. Child process failure
reaches the caller. Install invokes only normal CMake install; a missing build
artifact fails even if an older prefix exists. Install never builds.

Linux raw output is `cjcompat/build/build/bin/cjcompat`; default install is
`cjcompat/dist/bin/cjcompat`. An explicit prefix installs `bin/cjcompat` there.
There are no cjcompat-generated shared libraries, configs, static directories or
JNI payloads. The imported AST shared library remains an SDK input, with its own
source/build/install/copy facts. It must not be reported as produced by cjcompat.

The CMake graph consumes exactly the selected SDK's `include/cangjie` and
`tools/lib/libcangjie-lsp.so` on Linux. It invokes the selected `bin/cjc -v` for
the version definition and rejects a failing invocation. Build RPATH selects the
input SDK's tools/lib. Install RPATH is `$ORIGIN/../lib` for placement at SDK
tools/bin beside tools/lib; standalone component consumption needs the selected
SDK library search path. No shared N library is rebuilt or silently copied.
Windows/Apple graph branches remain explicit but are dynamically NOT_RUN.
Cross Windows version-query consumption requires a runnable selected compiler
entry; no host output is substituted when it is unavailable.

## AST source relationship and qualification boundary

Selected N/AST source is `f07c55738c12c154160c313c630a42a73a51025d`. Its root
CMake installs the public include/cangjie tree, and its src/CMake includes Parse,
Mangle, Frontend, Modules, Sema and AST object targets in cangjie-lsp-share and
installs the shared library to tools/lib. `CompilerInstance`, `BuildIndex`,
`LoadPackageFromCjo`, `PerformSema`, `ASTHasher::BodyHash`, AST cloning/walking and
`BaseMangler::Mangle` have corresponding declarations in that fixed source.
No additional compiler .cpp or source checkout is required by this consumer.
The SDK writer records that fixed N source and its actual installed library;
there is no second dependency installer or invented CLI source default.

This source relationship is not compilation, ABI, CJO-format or business
qualification. `tests/cjcompat-producer.mjs` is a pending Linux gate through normal
build/install, compiler-produced CJO pairs, default/API/ABI comparisons, an
independent tool control and component package/unpack consumption. Its JSON
config contains `sdk`, positive integer `jobs`, fresh absolute `work`, `control`
(an installed independent tool plus real business arguments), and optional
`consumeOnly`. Actual SDK compiler/std/runtime and N inputs must be qualified and
resources admitted before execution. Complete SDK/all-tools/Windows qualification
and independent review remain separate obligations.
