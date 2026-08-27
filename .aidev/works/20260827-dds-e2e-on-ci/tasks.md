# タスク: エディタの GUI e2e を CI に載せる

- [x] T1: 再現率を 10 回測る
      対象: `.aidev/works/20260827-dds-e2e-on-ci/verify/e2e-stability.sh`（新規）
- [x] T2: `gui-e2e` ジョブ（依存: T1）
      対象: `.github/workflows/prompter-definitions.yml`
- [x] T3: `dev/README.md` に CI で走ることを書く（依存: T2）
      対象: `vscode-extension/dev/README.md`
- [ ] T4: CI で緑になることを確認（依存: T2）
      対象: 未特定（PR 上）
