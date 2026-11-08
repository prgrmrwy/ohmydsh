# Tasks

## 1. Launcher 私有文件边界

- [x] 1.1 实现 Windows SID/DACL 的创建/校验 helper，并接入 patch/noPet publisher/stop reader；以现有 POSIX 权限反例、原生 Windows patch 创建/重复写和实际过宽 ACL 拒绝验证。
- [x] 1.2 保持 reader 的 lstat/open/fstat、大小、owner 和缺失/不安全区别；以真实显式/继承 ACE、junction、查询失败且无 HTTP/停止信号反例验证。

## 2. 独立 Pet producer

- [x] 2.1 在 Pet 内独立打包同等 Windows 权限 helper，接入 publisher/release，不改函数签名或 wire；由不经过 launcher 预建的原生 Windows 跨生产者读取、替换和 boot cleanup 用例验证。
- [x] 2.2 更新 Pet package/manifest/root lock 的修复版本并保留 POSIX 行为；用 package build/typecheck 和 descriptor/launcher contract tests 验证，无构建产物提交。

## 3. 原生集成与收口

- [x] 3.1 将 native ACL contract suite 及必需构建接入 Windows root test selector；用真实 Windows CI 两个 Node 版本证明执行了权限负例及既有生命周期套件，不移除测试、不增大默认超时。
- [x] 3.2 完成代码自审、独立安全复核、相关 POSIX/全部要求 CI、严格 OpenSpec/artifact 校验，记录实际结果；只有验证完成后同步 current spec 并归档，失败则保留未完成状态。
