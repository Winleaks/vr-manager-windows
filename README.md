# VR - Hub Management

Daily Cash sincronizează declarațiile șoferilor pe Writer și afișează progresul la reîncercarea manuală. Confirmarea încasării și publicarea soldului în platformă sunt etape distincte; notificarea financiară rămâne până la confirmarea soldului.

În registrul separat, o salvare criptată confirmată dă prioritate companiilor afectate. Publicarea verifică PDF-urile și confirmă soldul pentru fiecare companie înainte de a pregăti documentele celorlalte. O versiune nouă preia publicarea între confirmări complete; operațiile financiare existente nu sunt reaplicate. Lista de priorități rămâne în memoria procesului principal, iar coada criptată și notificarea de sincronizare păstrează reluarea după repornire.

## Development

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
