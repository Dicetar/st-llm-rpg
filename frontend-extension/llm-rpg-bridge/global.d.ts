export {};
import '../../../../public/global';
import '../../../../global';

declare global {
  interface Window {
    llmRpgBridgeInterceptor?: (...args: any[]) => Promise<void>;
  }
}
