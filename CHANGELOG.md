# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-17

### Added

- `capture` command: records requests, response headers and response bodies
  from any Chromium-family browser over the DevTools Protocol.
- Two connection modes: spawn the browser (`launch`) or attach to one that is
  already running with `--remote-debugging-port` (`--attach`). The attach mode
  makes the tool usable inside sandboxes that forbid spawning a browser.
- `launch`, `list`, `show`, `export` and `replay` commands.
- Session format on disk: `meta.json`, `requests.jsonl`, `bodies/*.bin`,
  `bodies/*.txt`, `summary.json`.
- Automatic GBK/GB18030 decoding for responses without a declared charset.
- Credential redaction in form payloads, enabled by default.
- URL / resource-type / status filters on both capture and read commands.
- Library API (`capture`, `Recorder`, `TargetWatcher`, `Session`, …) so the
  same primitives can be embedded in other tools.
- Zero runtime dependencies; requires Node.js 22 or newer.
