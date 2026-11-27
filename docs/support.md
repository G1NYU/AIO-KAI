# Tsugi support

Found a cicada? Thank you for helping improve Tsugi.

Open **App settings → Report bugs** from the media index or your media workspace. Browse [existing issues](https://github.com/G1NYU/TSUGI/issues) before [opening a new issue](https://github.com/G1NYU/TSUGI/issues/new/choose). Tsugi is an independent fork; report Tsugi-specific problems here rather than on the upstream AIOStreams tracker.

## Make a useful report

- Describe the affected section and the smallest reproducible sequence, the actual result and the expected result.
- Include your Windows version and architecture and the Tsugi build or release.
- Under **App settings → Diagnostics**, select **Create support summary**. Review its contents, then select **Copy support summary** and paste it into the issue. This allowlisted summary contains build and engine versions and capability flags; creating or copying it does not upload anything.
- Screenshots and short, reviewed error messages can help. Do not post credentials, session tokens, personal API keys, private account information, configured addon URLs, private stream links, unredacted logs, backups or profile databases.

GitHub issues are public. For security-sensitive findings, use GitHub private vulnerability reporting if it is available, or request a private reporting channel without disclosing sensitive details.

The Tsugi-specific issue form is maintained on the development branch and becomes available in the public issue chooser when it is included on GitHub's default branch. Until then, select the applicable app report in the chooser and omit private or irrelevant upstream fields.

## About, credits and licensing

App settings also exposes the application and build versions, matching source when a commit is known, release notes, credits, AGPL-3.0 and a searchable dependency-license index. Consult the [project license](../LICENSE), [credits](../README.md#credits--license), [third-party notices](../packages/desktop/THIRD-PARTY.md) and the notices and source materials distributed with each portable package. The dependency index is not a replacement for the complete packaged notices for separate executables.

Tsugi does not supply media sources or subscriptions. Use sources you are authorized to access. Provider accounts and service availability are managed by their respective operators.

## Development quality review

Automated validation and CodeRabbit review are separate gates. In a network-enabled checkout of the development branch, install the official CodeRabbit CLI, authenticate with `coderabbit auth login --agent` if needed, then run `coderabbit review --agent --base main` or use a narrower reviewed base commit for an incremental review. Resolve findings and rerun validation before release. Do not treat an unavailable review as approval.
