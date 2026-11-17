#!/usr/bin/env python3
"""
SUPER FYY - Standalone Python AST Extractor
Extracts modules, classes, functions, imports, decorators, and SQL references from a Python source file.
"""

import sys
import os
import ast
import json
import re

SQL_TABLE_REGEX = re.compile(
    r'\b(?:FROM|JOIN|INTO|UPDATE|TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)\s+([a-zA-Z_][a-zA-Z0-9_]*)',
    re.IGNORECASE
)

# Filter out common python libraries and false positives
NON_TABLE_WORDS = {
    'select', 'where', 'set', 'values', 'if', 'not', 'exists', 'table',
    'datetime', 'pathlib', 'sqlite', 'sqlite3', 'typing', 'pandas', 'os', 'sys', 're', 'json',
    'import', 'as', 'from', 'in', 'is', 'and', 'or', 'def', 'class', 'return', 'none', 'true', 'false'
}

def extract_sql_tables(source_code: str) -> list[str]:
    tables = set()
    # Match CREATE TABLE [IF NOT EXISTS] tablename
    create_matches = re.finditer(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)', source_code, re.IGNORECASE)
    for m in create_matches:
        tbl = m.group(1).lower()
        if tbl not in NON_TABLE_WORDS:
            tables.add(tbl)

    # Match queries: FROM tablename, INTO tablename, UPDATE tablename, JOIN tablename
    query_matches = re.finditer(r'\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)', source_code, re.IGNORECASE)
    for m in query_matches:
        tbl = m.group(1).lower()
        if tbl not in NON_TABLE_WORDS and not tbl.startswith(('src.', 'tests.', 'components.')):
            tables.add(tbl)

    return sorted(list(tables))

def parse_python_file(file_path: str) -> dict:
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        return {"error": f"Failed to read file: {str(e)}"}

    try:
        tree = ast.parse(content, filename=file_path)
    except SyntaxError as e:
        return {"error": f"SyntaxError at line {e.lineno}: {e.msg}"}
    except Exception as e:
        return {"error": f"AST parsing failed: {str(e)}"}

    docstring = ast.get_docstring(tree) or ""
    classes = []
    functions = []
    imports = []
    endpoints = []

    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            c_doc = ast.get_docstring(node) or ""
            bases = []
            for b in node.bases:
                try:
                    bases.append(ast.unparse(b))
                except:
                    pass
            classes.append({
                "name": node.name,
                "lineStart": node.lineno,
                "lineEnd": getattr(node, "end_lineno", node.lineno),
                "summary": c_doc.strip().split("\n")[0] if c_doc else f"Class {node.name}",
                "bases": bases
            })
            # Check methods
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    m_doc = ast.get_docstring(item) or ""
                    decs = []
                    for d in item.decorator_list:
                        try:
                            decs.append(ast.unparse(d))
                        except:
                            pass
                    functions.append({
                        "name": f"{node.name}.{item.name}",
                        "parent": node.name,
                        "lineStart": item.lineno,
                        "lineEnd": getattr(item, "end_lineno", item.lineno),
                        "summary": m_doc.strip().split("\n")[0] if m_doc else f"Method {item.name}",
                        "decorators": decs
                    })

        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            f_doc = ast.get_docstring(node) or ""
            decs = []
            for d in node.decorator_list:
                try:
                    decs.append(ast.unparse(d))
                except:
                    pass
            functions.append({
                "name": node.name,
                "parent": None,
                "lineStart": node.lineno,
                "lineEnd": getattr(node, "end_lineno", node.lineno),
                "summary": f_doc.strip().split("\n")[0] if f_doc else f"Function {node.name}",
                "decorators": decs
            })

            # Detect API route decorators (Flask, FastAPI, Streamlit, etc.)
            for d in decs:
                if any(k in d for k in ["route", "get", "post", "put", "delete", "endpoint", "api"]):
                    endpoints.append({
                        "name": f"ENDPOINT:{node.name}",
                        "decorator": d,
                        "line": node.lineno
                    })

        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({
                    "module": alias.name,
                    "name": alias.asname or alias.name
                })

        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for alias in node.names:
                imports.append({
                    "module": mod,
                    "name": alias.name,
                    "asname": alias.asname
                })

    tables = extract_sql_tables(content)

    return {
        "docstring": docstring.strip().split("\n")[0] if docstring else "",
        "classes": classes,
        "functions": functions,
        "imports": imports,
        "endpoints": endpoints,
        "sqlTables": tables
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)

    result = parse_python_file(sys.argv[1])
    print(json.dumps(result))
