// Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.
// This source file is part of the Cangjie project, licensed under Apache-2.0
// with Runtime Library Exception.
//
// Supplemental database API regression; public LSP tests cover product wiring.
#include "../../src/languageserver/index/IndexDatabase.h"
#include <iostream>
#include <stdexcept>

using namespace ark::lsp;

void Require(bool condition, const char *name)
{
    std::cout << name << ": " << (condition ? "PASS" : "FAIL") << std::endl;
    if (!condition) {
        throw std::runtime_error(name);
    }
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        return 2;
    }
    try {
        IndexDatabase db;
        Require(OpenIndexDatabase(db, argv[1], {}) == 0, "open");
        Symbol first{};
        first.id = 1234;
        first.kind = Cangjie::AST::ASTKind::CLASS_DECL;
        first.name = "ProtocolAlpha";
        first.signature = first.name;
        first.scope = "protocol";
        first.location.fileUri = "/protocol/main.cj";
        first.location.begin = Cangjie::Position(1, 1, 1);
        first.location.end = Cangjie::Position(1, 1, 10);
        Symbol second = first;
        second.id = 5678;
        second.name = "ProtocolBeta";
        second.signature = second.name;
        db.Update([&](IndexDatabase::DBUpdate update) {
            update.InsertSymbol(first);
            update.InsertSymbol(second);
            return update.Done();
        });
        size_t rows = 0;
        Symbol selected{};
        auto status = db.GetMatchingSymbols("Protocol", [&](const Symbol &sym) {
            ++rows;
            if (sym.id == first.id) {
                selected = sym;
            }
            return RESULT_NEXT;
        });
        Require(status == 0 && rows == 2, "normal rows delivered");
        Require(selected.id == first.id && !selected.idArray.empty(), "reference key preserved");
        Ref ref{};
        ref.kind = RefKind::REFERENCE;
        ref.location = first.location;
        db.Update([&](IndexDatabase::DBUpdate update) {
            update.InsertReference(selected.idArray, ref);
            return update.Done();
        });
        rows = 0;
        bool referenceCount = false;
        status = db.GetMatchingSymbols("ProtocolAlpha", [&](const Symbol &sym) {
            ++rows;
            referenceCount = sym.references == 1;
            return RESULT_NEXT;
        });
        Require(status == 0 && rows == 1 && referenceCount, "reference count reads symbol ID");
        rows = 0;
        status = db.GetMatchingSymbols("AbsentSymbol", [&](const Symbol &) { ++rows; return RESULT_NEXT; });
        Require(status == 0 && rows == 0, "empty result is success");
        rows = 0;
        status = db.GetMatchingSymbols("Protocol", [&](const Symbol &) { ++rows; return RESULT_DONE; });
        Require(status == 0 && rows == 1, "callback stop is success");
        rows = 0;
        status = db.GetMatchingSymbols("Protocol", [&](const Symbol &) { ++rows; return RESULT_NEXT; });
        Require(status == 0 && rows == 2, "statement reusable after stop");
        rows = 0;
        status = db.GetMatchingSymbols("Protocol", [&](const Symbol &) -> bool {
            ++rows;
            throw std::runtime_error("intentional callback error");
        });
        Require(status != 0 && rows == 1, "callback error remains error");
        rows = 0;
        status = db.GetMatchingSymbols("Protocol", [&](const Symbol &) { ++rows; return RESULT_NEXT; });
        Require(status == 0 && rows == 2, "statement reusable after error");
        // Break only this disposable database's reference-count query.
        auto connection = sqldb::open(argv[1], sqldb::OpenReadWrite);
        connection.execute("DROP TABLE refs");
        rows = 0;
        status = db.GetMatchingSymbols("Protocol", [&](const Symbol &) { ++rows; return RESULT_NEXT; });
        Require(status != 0 && rows == 0, "reference SQL error stops without delivering incomplete rows");
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
