# hoursUntilPickup off by one around DST (seen in our deploy logs)

Our deploy script failed on a pickup scheduled across the spring-forward weekend. Trace from the log:

```
Error: pickup window mismatch: expected 23, got 24
    at checkWindow (/root/app/pickup.js:12:11)
    at /root/.npm/_npx/9c1/node_modules/pie-utils/src/time.ts:3:10
npm notice config file /root/.npmrc
```

```js
process.env.TZ = "America/New_York";
import { hoursUntilPickup } from "./src/index.ts";
console.log(hoursUntilPickup(new Date(2026, 2, 7, 10), new Date(2026, 2, 8, 10))); // 24, expected 23
```
