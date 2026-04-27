# iTerm2 Theme Gallery Makefile

.PHONY: help build start classify patch clean

help:
	@echo "Available commands:"
	@echo "  make build      - Build the Angular application"
	@echo "  make start      - Start the Angular development server"
	@echo "  make classify   - Recompute theme families using ML/Oklab"
	@echo "  make patch      - Run the iTerm2 Plist Patcher tool"
	@echo "  make clean      - Remove build artifacts and temporary files"

build:
	npm run build

rebuild: clean build

start:
	@echo "🚀 Cleaning up and starting Gallery..."
	@-pkill -f "node dist/iterm-gallery/server/server.mjs" || true
	@npm run build && (node dist/iterm-gallery/server/server.mjs & npx ng serve --proxy-config proxy.conf.json)

classify:
	npm run classify-themes

patch:
	node scripts/patch-iterm-themes.mjs

clean:
	rm -rf dist/
	rm -rf .angular/
	rm -rf user_data/
