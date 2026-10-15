# Installed LSP indexing regressions

Run `node cjo-searchpath.mjs SDK WORKSPACE EVIDENCE [default|explicit] [memory|database]`
against an independent installed SDK containing `tools/bin/LSPServer`. It queries
`std.ast.FuncDecl` and `std.collection.ArrayList` through stdio JSON-RPC. Both must
be classes in their expected package. The original test and its assertions are
retained unchanged.

`cjo-project-cache.mjs` uses the same queries and assertions and supplies the
public `multiModuleOption` for a project named `probe`. Use a source project with
`package probe` and `import std.ast.*`. Run it twice with the same workspace and
separate evidence directories to exercise persisted indexes. The first run must
produce `.cache/astdata/*.ast`; database mode also produces `.cache/index/index.db`.
With no module configuration, LSP assumes package `default`, independently of
`cjpm.toml`; a `probe` declaration in that configuration cannot prove AST cache reuse.

`source-control.mjs` takes the same arguments and an optional final `log` argument.
Copy `fixtures/ordinary` to a fresh workspace. It supplies the public module
configuration, opens the source with language ID `Cangjie`, and asserts that
`textDocument/documentSymbol` returns the source class `PlainControl`. This control
is independent of CJO loading and database fuzzy queries. It does not assert the
presence of `FuncDecl` or treat a target test's rc1 as control success.

All public tests use a constructed child environment with the selected SDK's
libraries, no `CANGJIE_PATH`, private HOME/cache/config, and record raw replies,
process mappings, assertions, and child exit status. They do not use `--test`,
which filters CJO symbols. Use resource controls and disable core dumps in the
caller. Missing symbols fail with rc1; protocol/preparation failures use rc2.

The supplemental `index-database-protocol.cpp` tests the native database API's
success/error status, row iteration, early callback stop, statement reset, and
reference-count key. It creates a disposable database and deliberately drops its
`refs` view at the end. Never pass a production database path. This API test
supplements, and does not replace, the installed public tests.

After a normal native `LSPServer` build, run:

```
node test/public/build-database-protocol.mjs /absolute/path/to/cangjie-language-server /absolute/evidence/api
LD_LIBRARY_PATH=/absolute/SDK/tools/lib /absolute/evidence/api/protocol /absolute/evidence/api/fresh.db
```

The adapter takes the native compile/link commands and objects from `build-lsp`,
replacing only the launcher object with the test main. No product test macro or
mock database is enabled. Compile and link commands, logs and exit codes are
retained. Test success is independent of `assert`/`NDEBUG`.
