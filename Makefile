PY ?= /tmp/havenv/bin/python3
HA = $(PY) scripts/ha.py

.PHONY: help dev dev-fixture fixture screenshot browse setup install restart wait update version logs events check

help:
	@printf 'Common targets:\n'
	@printf '\n'
	@printf '  Local frontend dev\n'
	@printf '    make dev                  start Vite at http://localhost:5173 (panel served from there)\n'
	@printf '    make dev-fixture          same, against dev/fixtures/remotes.json — no HA needed\n'
	@printf '    make fixture              regenerate dev/fixtures/remotes.json from the real layouts\n'
	@printf '    make screenshot PATH=…    full-page screenshot via Playwright (defaults to /remote-studio)\n'
	@printf '    make browse PATH=…        headed Chromium dump of panel internals\n'
	@printf '\n'
	@printf '  Live HA control\n'
	@printf '    make install              tell HACS to fetch + install the latest release\n'
	@printf '    make restart              restart Home Assistant\n'
	@printf '    make wait                 block until HA is responsive again\n'
	@printf '    make update               install + restart + wait (full update flow)\n'
	@printf '    make version              print installed integration version\n'
	@printf '    make logs FILTER=remote_  tail HA system_log (FILTER substring matches name+msg)\n'
	@printf '    make events DEVICE=<id>   listen for zha_event (40s by default; --event-type=… also works)\n'
	@printf '\n'
	@printf '  Sanity\n'
	@printf '    make check                compile + build every layout + pytest + node --test\n'
	@printf '\n'
	@printf '  Setup\n'
	@printf '    make setup                create the venv at /tmp/havenv with websocket-client + voluptuous + pyyaml\n'

# ---------------------------------------------------------------- frontend
dev:
	npm run dev

dev-fixture:
	VITE_BACKEND=fixture npm run dev

fixture:
	@$(PY) scripts/make_fixture.py

PATH_ARG ?= /remote-studio
OUT ?= /tmp/screenshot.png
screenshot:
	HA_URL=http://localhost:5173 npm run screenshot -- $(PATH_ARG) $(OUT)

browse:
	HA_URL=http://localhost:5173 npm run browse -- $(PATH_ARG)

# ---------------------------------------------------------------- HA control
setup:
	@if [ ! -x $(PY) ]; then \
	  python3 -m venv /tmp/havenv; \
	  echo "venv created at /tmp/havenv"; \
	fi
	@/tmp/havenv/bin/pip install -q websocket-client voluptuous pyyaml
	@echo "venv ready at /tmp/havenv (websocket-client, voluptuous, pyyaml)"

check:
	@$(PY) scripts/check.py

install:
	$(HA) install

restart:
	$(HA) restart

wait:
	$(HA) wait

update: install restart wait
	@echo '✓ updated and back up'

version:
	@$(HA) version

# Usage: make logs                   — last 30 entries
#        make logs FILTER=remote_studio
LIMIT ?= 30
logs:
ifeq ($(strip $(FILTER)),)
	$(HA) logs --limit $(LIMIT)
else
	$(HA) logs --filter '$(FILTER)' --limit $(LIMIT)
endif

# Usage: make events DEVICE=<id>     — listen for 40s on a specific device
#        make events DEVICE=<id> EVENT_TYPE=state_changed DURATION=15
EVENT_TYPE ?= zha_event
DURATION ?= 40
events:
	$(HA) events --event-type $(EVENT_TYPE) --duration $(DURATION) $(if $(DEVICE),--device $(DEVICE),)
