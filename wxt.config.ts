import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  imports: false,
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: '비드메이트',
    description: '입찰 공고 수집·정리·메일 작성 보조',
    permissions: ['storage', 'scripting', 'offscreen', 'sidePanel', 'tabs', 'downloads', 'unlimitedStorage', 'alarms', 'notifications'],
    // debugger는 Chrome이 선택 권한으로 허용하지 않아 뺐다(네이버웍스 입력 2차 수단이 필요해지면 그때 결정).
    optional_permissions: ['webRequest', 'clipboardRead'],
    host_permissions: ['https://apis.data.go.kr/*', 'https://www.g2b.go.kr/*'],
    optional_host_permissions: ['https://*/*'],
    background: { type: 'module' },
    web_accessible_resources: [{ resources: ['icon/mascot/*'], matches: ['https://*/*'] }, { resources: ['fonts/PretendardVariable.woff2'], matches: ['https://www.g2b.go.kr/*'] }],
  },
});
