## 1. 命令表与解析

- [x] 1.1 先写失败测试：`-h` / `--help` / `/help` 解析为 help；命令表与解析器交叉校验
- [x] 1.2 admission.ts：引入唯一命令表，解析器按表识别；help 命令在 retired 入口放行

## 2. 回执

- [x] 2.1 先写失败测试：dispatcher 对 help 返回由命令表生成的文本，不含 /scope /tools，不调用 bind/exit/access
- [x] 2.2 control.ts：help 分支；channel 的格式错误分支不受影响

## 3. 验证

- [x] 3.1 一次变异检查；tsc 0 错误；dsh-pet 全量测试通过
