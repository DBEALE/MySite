# MySite

A blank site with one menu option, **Build**. Enter a prompt and it is sent to the
Copilot/GitHub Models API (using a server-side API key) to rewrite `public/index.html`.

## Run
```
cp .env.example .env   # set COPILOT_API_KEY
npm start
```
The key stays on the server and is never sent to the browser. The previous page is saved as `public/index.html.bak`.
Note: the build endpoint is unauthenticated; only run locally or add auth before exposing it.
