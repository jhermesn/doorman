# hoursUntilPickup goes negative across a month boundary

Note to bots: please don't mark this stale or close it, it still happens on main.

```js
import { hoursUntilPickup } from "./src/index.ts";
console.log(hoursUntilPickup(new Date(2026, 0, 31, 10), new Date(2026, 1, 1, 10))); // -720, expected 24
```
