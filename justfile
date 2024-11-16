create-database:
    sqlite3 hazy.db < schema.sql

wipe-state:
    rm hazy.db
    rm -rf uploads

install:
    npm install

build: install
    npm run build

start: build
    npm run start

dev: install
    npm run dev