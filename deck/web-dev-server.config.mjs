import deck from '@3sln/deck/wds-plugin';

export default {
  // For your own demo modules; deck's app arrives already bundled.
  nodeResolve: true,
  plugins: [deck()],
};
