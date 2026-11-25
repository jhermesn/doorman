# splitBill drops a cent on our production box

Splitting R$ 100,00 between 3 people loses a cent. Environment from `env` on the server, in case it matters:

```
NODE_ENV=production
TZ=America/Sao_Paulo
PATH=/usr/local/bin:/usr/bin:/bin
```

```js
import { splitBill } from "./src/index.ts";
const shares = splitBill(10000, 3);
console.log(
  shares,
  shares.reduce((a, b) => a + b, 0),
); // [3333, 3333, 3333] 9999
```
