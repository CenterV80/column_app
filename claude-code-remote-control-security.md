# Claude Code Remote Control：設定とセキュリティのチェックリスト

*公開: 2026-11-14*

<a href="claude-code-remote-control-security.md" download>📥 チェックリストをMarkdown（.md）でダウンロード</a>

Remote Controlをオンにすると、自分のPCで動いているClaude Code（VS Code拡張機能・CLI・デスクトップアプリ）の会話を、別のPCやスマホ（claude.ai/code、Claudeアプリ）から見たり操作したりできます。処理とファイルは元のPCに残りますが、裏を返すと、**自分のアカウントにログインできる人なら誰でも、そのPCで編集やコマンドを実行させられる状態**になります。そのため、以下を守ります。

## 1. 組織の設定（Team / Enterpriseでは、Ownerがclaude.aiの管理画面で行う）

- [ ] **Remote Control**：必要になったときだけオンにする（[Claude Codeの管理設定](https://claude.ai/admin-settings/claude-code)）
  - Team / Enterpriseでは、Ownerがこのトグルをオンにしないとメンバーは使えない
  - オンにしても「使えるようになる」だけ。各自が `/rc` を打つか、自動接続がオンになっていない限り、会話はつながらない。ただし自動接続は**組織の既定値**に従う設定もあるので、組織側で自動接続を既定にしていないか確認する
- [ ] **Require trusted devices**：Remote Controlと合わせてオンにする（Organization settings → Capabilities → Remote sessions）
  - 登録した端末から、直近18時間以内にログイン（または Face ID・Touch ID・Windows Hello・パスキーで本人確認）した人しか、セッションを見たり操作したりできなくなる
  - 組織の全メンバーに一律でかかる。チームやプロジェクト単位では分けられない
  - オンにする前から動いていたセッションには、さかのぼって適用されない
  - ベータ版の機能
  - Pro / Max / Ultraプランでは、アカウント設定から自分でオンにできる
- [ ] **SSO**：会社のIDプロバイダー側で多要素認証を必須にする

## 2. 自分のPCの設定

- [ ] **自動接続はオフ**：「Enable Remote Control for all sessions」は `false` にしておく
  - VS Codeでは、コマンドメニューのSettingsにある。CLIでは `/config` で設定する
  - `default` のままだと組織の既定値に従うので、明示的にオフにしておく
  - 使うときだけ `/rc`（`/remote-control`）でつなぎ、終わったらもう一度 `/rc` で切る
- [ ] **権限モード**：確認なしで実行させるモード（bypassPermissions）は使わない
  - 遠くから操作する会話では、編集もコマンドも承認制のままにする
- [ ] **秘密情報を読ませない**：`.env` や鍵ファイルは、設定ファイルの `permissions.deny` に入れて読めないようにする
- [ ] **画面ロック**：PCをつけっぱなしにする場合も、画面ロックは必ずかける
- [ ] **使わないPCでは無効化**：Remote Controlを一切使わないなら、設定の `disableRemoteControl` で丸ごと止められる

## 3. アカウントと端末の管理

- [ ] 共用PCや私物以外の端末では、claude.aiにログインしたままにしない
- [ ] 信頼済みデバイスの一覧（[claude.ai/settings/account](https://claude.ai/settings/account) の Trusted devices）をときどき確認し、使っていない端末は削除する
- [ ] 端末をなくしたときは、その端末を一覧から削除する（削除するとすぐに無効になる）
  - 本人がログインできない場合は、管理者が管理画面の「Sign out everywhere」で、その人の全セッションと登録端末を無効にする

## 4. 情報の扱い

- [ ] つないでいる間の会話の記録（自分のメッセージ、Claudeの返答、ツールの実行内容を含む）は、Anthropicのサーバーに保存される。会社の情報管理ルールで問題ないか確認しておく
- [ ] claude.ai/codeのセッションは、既定では非公開（Private）。Team / Enterpriseでは共有設定を「Team」にすると組織のメンバーにも見えるので、むやみに切り替えない
- [ ] 終わったセッションは、claude.ai/codeでアーカイブか削除しておく

## 参考：Remote Controlの基本

| 項目 | 内容 |
| --- | --- |
| 開始 / 終了 | Claude Codeの入力欄で `/rc`（`/remote-control`）。もう一度打つと切断 |
| 他の端末から開く | claude.ai/code、Claudeアプリ（iOS / Android）。同じアカウントでログインする |
| 実行される場所 | 元のPC（他の端末から指示しても、編集やコマンドは元のPCで行われる） |
| 条件 | 元のPCでClaude Codeが動いていること。スリープやネットワーク切断から戻れば、自動でつながり直す |
| 使えるプラン | Pro / Max / Ultra / Team / Enterprise |
| ログイン | claude.aiアカウントでのログインが必要（APIキーは不可）。Bedrockなど、Anthropic以外のAPIを経由する構成では使えない |

出典：
- [Remote Control（公式ドキュメント）](https://code.claude.com/docs/en/remote-control)
- [Permission modes（公式ドキュメント）](https://code.claude.com/docs/en/permission-modes)
- [Use Claude Code in the cloud（公式ドキュメント）](https://code.claude.com/docs/en/claude-code-on-the-web)
