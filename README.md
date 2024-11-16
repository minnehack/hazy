# hazy

the successor to [opaque](https://github.com/minnehack/Opaque), itself a successor to (i think it was called "transparent"?)

## requirements

- a gmail account that you can make an app password for
- nix (optional, recommended)

## installing

1. enter the nix devshell or install the dependencies from it manually
2. `just build` (or `npm install && npm run build`)
3. `just create-database` (or `sqlite3 hazy.db < schema.sql`)

## running

1. fill in `.env` with values from `.env.example`
2. `just start` (or `npm run start`)

note that any qr codes generated are immediately bound to the currently set `ORIGIN`, so if you change
`ORIGIN` you will need to `rm -r qr-cache`

## deploying

probably put it behind nginx or something

## developing

`just dev` / `npm run dev` will start an instance that automatically restarts on file changes

## license

non-violent public license (NVPL), see `LICENSE.md`

## security considerations

- the admin system is pretty underwhelming. if you have higher standards than "password stored in a `.env`",
  you should probably turn that into a more real authentication system
- the `/registration` endpoint _should_ be pretty secure and do most possible checking for bad values, but
  it's always possible that there's something that will get through
- the file uploads could get larger than you expect. there's a 10mb limit on files uploaded, and they're
  renamed to a random ID, but user files are scary, so be careful
- i think it should be fine on xss
- exposing user registration codes should not be a security issue unless you assume attackers have admin,
  in which case they can get people's names as well as see if they've checked in / check them in themselves.
  no other info is exposed to the client