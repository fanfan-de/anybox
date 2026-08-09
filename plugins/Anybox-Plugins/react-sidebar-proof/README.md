# React Sidebar Proof

This is a view-only Anybox plugin. Its manifest declares `./web/index.html` as a `right-sidebar` View; the `web/` directory is the complete built React application shipped in the plugin package.

Build the bundled UI with:

```powershell
corepack pnpm install --ignore-workspace --lockfile=false
corepack pnpm build
```

Install and enable `react-sidebar-proof` in Anybox, open the Right Sidebar launcher, then choose **React Sidebar Proof**. The counter and accent selector prove that the rendered page owns live React state.
