import { useGetStartupConfig } from '~/data-provider';

/** True when `interface.layout` is `minimal`; the stock layout until the startup config loads. */
export default function useMinimalLayout(): boolean {
  const { data: startupConfig } = useGetStartupConfig();
  return startupConfig?.interface?.layout === 'minimal';
}
