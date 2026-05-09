## [0.22.1](https://github.com/bitkill/remote-studio/compare/v0.22.0...v0.22.1) (2026-05-09)

### 🐛 Bug Fixes

* **panel:** bluetooth + xiaomi_ble integration chip on the index card ([c09e40d](https://github.com/bitkill/remote-studio/commit/c09e40d37c59c12873e8840f42b3ff331cc11900))

## [0.22.0](https://github.com/bitkill/remote-studio/compare/v0.21.0...v0.22.0) (2026-05-09)

### ✨ Features

* **panel:** scene role for long-press defaults + colour picker ([9e2cde5](https://github.com/bitkill/remote-studio/commit/9e2cde57f563fb589a859defe951d7a9dc2f5dbe)), closes [#ffd9a8](https://github.com/bitkill/remote-studio/issues/ffd9a8)

# [0.21.0](https://github.com/bitkill/remote-studio/compare/v0.20.0...v0.21.0) (2026-05-09)


### Features

* **panel:** low-latency BILRESA scroll wheel + one-click "enable sensors" ([5185033](https://github.com/bitkill/remote-studio/commit/5185033fe26809d466361e049966c496a14fe135))

# [0.20.0](https://github.com/bitkill/remote-studio/compare/v0.19.0...v0.20.0) (2026-05-08)


### Features

* **panel:** support Yeelight YLKG07YL via xiaomi_ble integration ([8f87863](https://github.com/bitkill/remote-studio/commit/8f87863307a6934d81f7324a9548fbc970c1f613))

# [0.19.0](https://github.com/bitkill/remote-studio/compare/v0.18.0...v0.19.0) (2026-05-07)


### Features

* **panel:** show controlled entities on each remote card + filter on them ([6e2e5a6](https://github.com/bitkill/remote-studio/commit/6e2e5a6b61fd66e8f468762e468e7d382f82bc98))

# [0.18.0](https://github.com/bitkill/remote-studio/compare/v0.17.0...v0.18.0) (2026-05-07)


### Features

* **panel:** squircle STYRBAR body + 20% default dim step ([c116315](https://github.com/bitkill/remote-studio/commit/c11631577f4e55667ec4703ddef3de2660cb205a))

# [0.17.0](https://github.com/bitkill/remote-studio/compare/v0.16.1...v0.17.0) (2026-05-07)


### Features

* **panel:** live state pane with per-entity WS subscriptions ([39aead1](https://github.com/bitkill/remote-studio/commit/39aead13cfddc18956a15dfbed8eeedc72c2e591))

## [0.16.1](https://github.com/bitkill/remote-studio/compare/v0.16.0...v0.16.1) (2026-05-07)


### Bug Fixes

* **panel:** readable selected-row in HA themes + always show light colour ([b0a7ab2](https://github.com/bitkill/remote-studio/commit/b0a7ab20bfb44477c2b27f9b52a6beafad5c2f1d))

# [0.16.0](https://github.com/bitkill/remote-studio/compare/v0.15.0...v0.16.0) (2026-05-07)


### Features

* **panel:** live entity-state pane next to the group's target picker ([0fb8601](https://github.com/bitkill/remote-studio/commit/0fb8601f06c761900766443e273c76a77aa13159))

# [0.15.0](https://github.com/bitkill/remote-studio/compare/v0.14.2...v0.15.0) (2026-05-07)


### Features

* **panel:** power-button glyphs on Hue Dimmer v1 ([1ada69f](https://github.com/bitkill/remote-studio/commit/1ada69fc08f4fd9ef3fc518b79fa3a8c5cad98cb))

## [0.14.2](https://github.com/bitkill/remote-studio/compare/v0.14.1...v0.14.2) (2026-05-07)


### Bug Fixes

* **panel:** ship our own searchable entity picker instead of ha-target-picker ([168cd1b](https://github.com/bitkill/remote-studio/commit/168cd1b5991b68d24e0349df8eea0a458d4abf0f))

## [0.14.1](https://github.com/bitkill/remote-studio/compare/v0.14.0...v0.14.1) (2026-05-06)


### Bug Fixes

* **storage:** subclass Store to provide v1->v2 migrator ([d56a71b](https://github.com/bitkill/remote-studio/commit/d56a71be7de335bc922ce978532b0bf8f4e679dc))

# [0.14.0](https://github.com/bitkill/remote-studio/compare/v0.13.2...v0.14.0) (2026-05-06)


### Features

* **panel:** per-group target picker + role-driven default actions ([e284064](https://github.com/bitkill/remote-studio/commit/e28406474beef762be96e3cba152d7fc83fcb56f))

## [0.13.2](https://github.com/bitkill/remote-studio/compare/v0.13.1...v0.13.2) (2026-05-06)


### Bug Fixes

* validate actions via SCRIPT_SCHEMA + drop release states ([4de914f](https://github.com/bitkill/remote-studio/commit/4de914f76a932f6b466f936cae847a244424742e))

## [0.13.1](https://github.com/bitkill/remote-studio/compare/v0.13.0...v0.13.1) (2026-05-06)


### Bug Fixes

* **hue:** wire ZHA events for the Hue Dimmer v1 / v2 layouts ([6b808db](https://github.com/bitkill/remote-studio/commit/6b808db099caf30deda735a84e80d3c402a05bd7))

# [0.13.0](https://github.com/bitkill/remote-studio/compare/v0.12.0...v0.13.0) (2026-05-06)


### Bug Fixes

* look up the automation EntityComponent via its HassKey ([4bfd564](https://github.com/bitkill/remote-studio/commit/4bfd564882a6c7125b9a24bb012c428757daf909))


### Features

* **panel:** recent-events log on the index and device pages ([785629d](https://github.com/bitkill/remote-studio/commit/785629d4f20dff044185ca61f386c3e189232790))

# [0.12.0](https://github.com/bitkill/remote-studio/compare/v0.11.0...v0.12.0) (2026-05-06)


### Features

* **panel:** warn when automations already trigger on the same device ([2f045e6](https://github.com/bitkill/remote-studio/commit/2f045e6c490eeb48406d3cc499553087ed14e0e1))

# [0.11.0](https://github.com/bitkill/remote-studio/compare/v0.10.0...v0.11.0) (2026-05-06)


### Features

* **panel:** rename views to index/device, move device URL behind /device/ ([9bb6d30](https://github.com/bitkill/remote-studio/commit/9bb6d30337c40bc333ee507c34b692980ff48962))

# [0.10.0](https://github.com/bitkill/remote-studio/compare/v0.9.0...v0.10.0) (2026-05-06)


### Features

* **panel:** monochrome integration icons + version tag in title ([e584e54](https://github.com/bitkill/remote-studio/commit/e584e54c13f542affdaabea37184b059cfc3aa5d))

# [0.9.0](https://github.com/bitkill/remote-studio/compare/v0.8.1...v0.9.0) (2026-05-06)


### Features

* **panel:** drop the 'Available layouts' section from the home view ([2e78e12](https://github.com/bitkill/remote-studio/commit/2e78e12a38c1b7c9b5e404dbcafea1a35d454b81))
