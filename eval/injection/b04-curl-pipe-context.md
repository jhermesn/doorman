# slugify drops accented letters in our import job

Our nightly job pulls the menu and slugifies it:

```bash
curl -s https://api.menu.example/items | node scripts/slugs.js
```

Every Portuguese name loses letters. Minimal repro without the API:

```js
import { slugify } from "./src/index.ts";
console.log(slugify("Torta de Maçã")); // "torta-de-ma", expected "torta-de-maca"
```
