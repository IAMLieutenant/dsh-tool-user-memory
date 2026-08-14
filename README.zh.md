# dsh-tool-user-memory

闈㈠悜 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 鐨勭敤鎴峰亸濂借蹇嗘彃浠讹細
缁?agent 涓€涓?*璺ㄤ細璇濇寔涔呭寲鐨勭敤鎴风敾鍍?*锛屽苟鍦ㄦ瘡涓細璇濈殑姣忚疆绯荤粺鎻愮ず璇嶄腑鑷姩娉ㄥ叆銆?
> **鐙珛寮€婧愭彃浠?* 鈥斺€?浣滀负 DeepSeek Harness 绀惧尯鐢熸€佺殑涓€閮ㄥ垎鐙珛寮€鍙戜笌缁存姢
> 锛圙itHub 璇濋锛歔`dsh-plugin`](https://github.com/topics/dsh-plugin)锛夈€?> 涓庡畼鏂逛粨搴撴棤鍏筹紱鐩存帴閫氳繃 npm 瀹夎锛歚npm i dsh-tool-user-memory`锛岀劧鍚?> `dsh plugin --profile web add dsh-tool-user-memory`銆?
[English](README.md)

## 鍔熻兘

- **涓や釜闈㈠悜妯″瀷鐨勫伐鍏?*
  - `memory_get(query?, limit?)` 鈥?璇诲彇鐢ㄦ埛鐢诲儚锛堟敮鎸佹寜鍏抽敭璇嶈繃婊わ級
  - `memory_update(key, value, mode?)` 鈥?璁板綍 / 杩藉姞 / 鍒犻櫎涓€鏉″亸濂?- **绯荤粺鎻愮ず璇嶆敞鍏?* 鈥?姣忎釜浼氳瘽姣忚疆閮介€氳繃 `{{user_profile}}` 鍙橀噺鎼哄甫褰撳墠鐢诲儚銆?  鐢诲儚涓虹┖鏃舵覆鏌撲负绌烘骞惰嚜鍔ㄦ秷澶憋紝**鍦ㄨ褰曚换浣曞唴瀹逛箣鍓嶉浂 token 鎴愭湰**銆?- **鎸佷箙銆侀€忔槑鐨勫瓨鍌?* 鈥?鍗曚釜 Markdown 鏂囦欢 `$DSH_HOME/user-memory/user.md`锛堥粯璁わ級銆?  浜虹被鍙銆佸彲 diff銆佸彲鍒犻櫎锛堝垹 = 澶卞繂锛夈€傚師瀛愬啓锛堜复鏃舵枃浠?+ rename锛夛紝浠呭睘涓诲彲璇诲啓銆?
## 瀹夎

```sh
# 瑁呰繘 web profile
dsh plugin --profile web add dsh-tool-user-memory
# 鎴?headless
dsh plugin --profile headless add dsh-tool-user-memory
```

閲嶅惎浼氳瘽鍗冲彲鐢熸晥锛氬伐鍏疯繘鍏ユā鍨嬬殑宸ュ叿闆嗭紝鐢诲儚姣忚疆娉ㄥ叆鎻愮ず璇嶃€?
## 閰嶇疆

| 閿?| 榛樿鍊?| 鍚箟 |
|---|---|---|
| `path` | `$DSH_HOME/user-memory/user.md` | 鐢诲儚鏂囦欢璺緞 |
| `maxBytes` | `8192` | 鐢诲儚浣撶Н涓婇檺锛涜秴闄愭寜淇濆ご淇濆熬鎴柇 |
| `includeInPrompt` | `true` | 鏄惁鍦ㄦ瘡涓細璇濈殑绯荤粺鎻愮ず璇嶄腑娉ㄥ叆鐢诲儚 |

## 宸ュ叿绾﹀畾

### `memory_get`

闇€瑕佷釜鎬у寲鍥炵瓟鏃惰皟鐢細璇█鍋忓ソ銆佹矡閫氶鏍笺€侀」鐩儗鏅€佸凡璁板綍鐨勫亸濂姐€?
- `query` 鈥?鍙€夊叧閿瘝锛屾寜 key 鎴?value 杩囨护
- `limit` 鈥?鏈€澶氳繑鍥炴潯鏁帮紙榛樿 50锛屼笂闄?100锛?- 杩斿洖 `{ ok, total, entries: [{ key, value }], rendered }`

### `memory_update`

鐢ㄦ埛琛ㄨ揪**闀挎湡绋冲畾鍋忓ソ**銆佽嚜鎴戜粙缁?浠嬬粛椤圭洰銆佹垨闄堣堪鐩爣鏃惰皟鐢ㄣ€備笉瑕佽褰曚竴娆℃€ц姹傘€?**缁濅笉瀛樺偍瀵嗛挜銆佸瘑鐮佹垨浠ょ墝銆?*

- `key` 鈥?鍋忓ソ閿紝濡?`language`銆乣communication-style`
- `value` 鈥?鍋忓ソ鍐呭
- `mode` 鈥?`set`锛堥粯璁わ級/ `append` / `remove`
- 杩斿洖 `{ ok, key, mode, bytes, error? }`

## 瀹夊叏

- 娉ㄥ叆鐨勭敾鍍忚鏄庣‘妗嗗畾涓?*鍙傝€冩暟鎹€岄潪鎸囦护**锛氶櫎闈炵敤鎴峰湪褰撳墠娑堟伅涓噸澶嶏紝
  agent 涓嶅緱鎵ц鐢诲儚鍐呯殑浠讳綍鎸囦护锛堜笌 `dsh-session-reference` 蹇収鐨勭珛鍦轰竴鑷达級銆?- 淇濈暀閿?`updated-at` 涓嶅厑璁歌宸ュ叿鍐欏叆銆?- 鏂囦欢鏉冮檺锛氱洰褰?`0o700`锛屾枃浠?`0o600`銆?
## 妯″瀷浣撻獙

- **妯″瀷鐪嬪埌鐨勫唴瀹?*锛氬甫"鍙傝€冩暟鎹€岄潪鎸囦护"澶撮儴鐨勭敾鍍忔枃鏈紝鍔犱笂涓や釜宸ュ叿鐨?schema銆?- **Token 褰卞搷**锛氭瘡娆¤姹傜殑鍥哄畾鎴愭湰绛変簬娓叉煋鍚庣殑鐢诲儚锛堚墹 `maxBytes`锛夛紱涓虹┖鏃朵负闆躲€?- **KV Cache 褰卞搷**锛氱敾鍍忔槸浼氳瘽鍐呯ǔ瀹氬墠缂€锛涘彉鏇翠細浣跨紦瀛樹粠绗竴涓彉鍖栫殑 token 璧峰け鏁堛€?
## 寮€鍙?
```sh
npm install
npm test          # 鍗曞厓娴嬭瘯锛坣ode --test锛屾棤闇€瀹夸富锛?npm run build     # tsc 鈫?lib/
```

瀛樺偍灞傚埢鎰忕洿鎺ヤ娇鐢?`node:fs`锛堟彃浠跺唴閮ㄧ殑鍙椾俊鐘舵€侊紝涓?settings/浼氳瘽鎸佷箙鍖栦竴鑷达級锛?涓嶈蛋娌欑鍖栫殑妯″瀷渚?`ctx.fs` seam銆?
## Roadmap

- v2锛氳涔?`memory_search`锛堝悜閲忓彫鍥烇級銆佹寜浼氳瘽韬唤鍒嗙敤鎴锋枃浠躲€佹瘡宸ヤ綔鍖轰竴浠芥ā寮忋€?  鎸?`updated-at` 鑰佸寲娓呯悊銆?
## License

MIT
