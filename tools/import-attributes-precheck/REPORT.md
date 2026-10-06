# Import Attributes 预检报告 / Import-Attributes Pre-check Report

本目录是一个**显式 import attributes 预检**小工具：在不执行源码、不改写源码的前提下，
静态检查 `import` 属性子句中解码后同名 key 的重复问题。

This directory contains a small **explicit pre-check** for import attributes:
it statically detects duplicate keys (compared after decoding) without ever
evaluating or rewriting source.

## 1. 方言（单独成节，不与检查结果混排） / Dialect (separate section)

方言完全由 Babel parser **插件模式**决定，两种方言各用各的关键字、AST 字段和
动态 `import()` 选项 key，语义互不混用：

The dialect is selected purely by the Babel parser **plugin mode**. The two
dialects never share a keyword, AST field, option key, or semantics:

| 方言 dialect | 插件 plugin | 静态关键字 static keyword | AST 字段 AST field | 动态选项 key dynamic option key |
| --- | --- | --- | --- | --- |
| `attributes` | `["importAttributes", { "deprecatedAssertSyntax": false }]` | `with` | `attributes` | `with` |
| `assertions` | `"importAssertions"` | `assert` | `assertions` | `assert` |

- 在 `attributes` 方言下出现 `assert { ... }` 静态子句时，parser 报
  `ImportAttributesUseAssert`；该子句的属性**不会**被按 `with` 语义检查
  （定位到该错误所在语句后整体跳过重复判定，`entries` 不计入）。
- Under the `attributes` dialect, a static `assert { ... }` clause raises
  `ImportAttributesUseAssert`; its attributes are **not** duplicate-checked
  with `with` semantics.
- 动态 `import()` 第二参数里，只认当前方言的选项 key（`with`/`assert`），
  另一方言的 key 视为普通外部选项，不套用本地方言语义。
- In a dynamic `import()` options object only the active dialect key is
  inspected; the other dialect key is treated as a foreign option.

普通语法开关保留 / Ordinary syntax switches are preserved：是否能解析某种语法仍由
parser 插件开关决定。`assert` 在没有对应插件时直接是语法错误
（`ImportAttributesUseAssert`）；预检工具不会隐式打开任何语法开关，只通过显式
`--dialect` 选择插件模式。

## 2. 检查规则 / Rules

1. **解码后比较**：key 取 Babel 解码后的值（`StringLiteral.value` /
   `Identifier.name`）。`type` 与 `"\\u0074ype"` 解码后同为 `type`，无法靠字符串
   写法不同避开重复。原始写法（`raw`）只用于报告展示。
   Keys are compared on **decoded** values, so different escape spellings of the
   same key cannot evade duplicate detection. Raw spelling is display-only.
2. **动态 import 只在能静态识别时判断**：第二参数必须是对象字面量、方言 key 的值
   也必须是对象字面量，且所有属性 key 都是字面量、无 spread、无计算/访问器属性。
   遇到 spread（如 `{ ...opts }`）、计算 key、非字面量等，结果记为
   `unconfirmable`，既不误报也不静默通过。
   Dynamic options are judged only when fully statically recognizable; a spread
   or computed key yields an `unconfirmable` finding.
3. **错误带双方位置**：每条重复错误都包含 `firstLoc`（首个出现）与
   `duplicateLoc`（重复出现）两个位置。
   Every duplicate error carries BOTH the first and the duplicate location.
4. **不执行表达式、不自动改源码**：不读取/求值属性值表达式（值只做结构识别），
   工具不写回源文件；报告中 `expressionsEvaluated` 恒为 `0`。
   No expression is ever evaluated and no source file is rewritten;
   `expressionsEvaluated` is always `0`.

## 3. 三个 import 例子 / The three import examples

文件位于 `examples/`（`attributes` 方言）：

| 文件 file | 内容摘要 snippet | 结论 verdict |
| --- | --- | --- |
| `examples/duplicate-type.js` | `import data from "./data.json" with { type: "json", "\u0074ype": "json" };` | **拒绝 REJECT**：解码后两个 `type`，报告首个与重复双方位置 |
| `examples/distinct-keys.js` | `import data from "./data.json" with { type: "json", webpack: "all" };` | **通过 PASS**：两个不同 key |
| `examples/dynamic-spread.js` | `import("./data.json", { with: { ...opts } });` | **无法静态确认 UNCONFIRMED**：子句含 spread；不计重复，表达式计数 0 |

## 4. Babel parser 定向命令 / Babel parser targeted commands

本仓库 worktree 不安装根级 `node_modules`，验收时把 npm 缓存与临时目录定向到
D 盘，并把 `@babel/parser` 安装在 D 盘缓存宿主目录（不污染 worktree / C 盘）：

The worktree has no root `node_modules`; for acceptance, npm cache/temp are
redirected to the D: drive and `@babel/parser` lives in a D:-drive host folder:

```bash
# 一次性准备（全部落在 D 盘） / one-time setup, entirely on D:
mkdir -p /d/Codex/gsb-cache/import-attr-precheck/{npm-cache,tmp,parser-pkg}
cd /d/Codex/gsb-cache/import-attr-precheck/parser-pkg
echo '{"name":"parser-host","version":"1.0.0","private":true}' > package.json
TEMP=D:/Codex/gsb-cache/import-attr-precheck/tmp \
TMP=D:/Codex/gsb-cache/import-attr-precheck/tmp \
npm_config_cache=D:/Codex/gsb-cache/import-attr-precheck/npm-cache \
npm install --loglevel=error @babel/parser@7   # 实测安装 7.29.9

# 验收测试 / acceptance tests
cd <worktree>/tools/import-attributes-precheck
IMPORT_ATTR_PARSER_PATH=D:/Codex/gsb-cache/import-attr-precheck/parser-pkg \
TEMP=D:/Codex/gsb-cache/import-attr-precheck/tmp \
TMP=D:/Codex/gsb-cache/import-attr-precheck/tmp \
node test/run-test.js

# 三例子人工报告 / human report over the three examples
PP=D:/Codex/gsb-cache/import-attr-precheck/parser-pkg
node src/cli.js --dialect attributes --parser-path "$PP" \
  examples/duplicate-type.js examples/distinct-keys.js examples/dynamic-spread.js

# JSON 报告（summary.dialect 单独给出方言） / JSON report
node src/cli.js --dialect attributes --json --parser-path "$PP" examples/duplicate-type.js

# 断言方言 / assertions dialect
node src/cli.js --dialect assertions --parser-path "$PP" some-assert-style-file.js
```

工具本身也支持普通 `require("@babel/parser")` 解析链：若运行环境中已安装
`@babel/parser`（`node_modules` 在解析路径上），可省略 `--parser-path` /
`IMPORT_ATTR_PARSER_PATH`。

## 5. 验收结果 / Acceptance results

- 两个等价 `type` 键（其一为 `"\\u0074ype"` 转义写法）→ **拒绝**，重复错误 1 条，
  含 `firstLoc`（1:38）与 `duplicateLoc`（1:52）。
  Two equivalent type keys -> REJECTED, one duplicate error carrying both
  locations (1:38 and 1:52).
- 不同 key（`type` / `webpack`）→ **通过**，重复错误 0 条。
  Distinct keys -> PASS.
- 动态 spread（`{ with: { ...opts } }`）→ `unconfirmable` 1 条，重复 0 条。
  Dynamic spread -> one unconfirmable finding, zero duplicates.
- 所有用例 `expressionsEvaluated` 均为 **0**；示例文件运行前后哈希一致
  （源码不被修改）。
  Expression evaluation count is **0** in every case; fixture hashes are
  unchanged after runs (source is never modified).
- 自动化小测试：`node test/run-test.js` 共 14 项，全部通过。
  Deterministic test suite: 14 tests, all passing.

## 6. 文件 / Files

- `src/index.js` — 预检核心：方言定义、解码比较、动态选项静态识别、AST 遍历。
- `src/cli.js` — 命令行入口（`--dialect`、`--json`、`--parser-path`）。
- `examples/` — 三个 import 例子夹具。
- `test/run-test.js` — 小型确定性验收测试（无外部测试框架）。
