import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Shuffle, Crown, Copy, RotateCcw, Sparkles, Link as LinkIcon, Save, AlertTriangle } from "lucide-react";

const SAMPLE_PLAYERS = 
`あ
い
う
え
お
か
き
く`;

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function nextPowerOfTwo(n) {
  return Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
}

function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const nextSize = order.length * 2;
    order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return order.slice(0, size);
}

function cleanName(raw) {
  return raw.replace(/^[\s\-•*]+/, "").trim();
}

function parsePlayers(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .map((line, index) => {
      const match = line.match(/^#?\s*(\d+)\s*[.)：:,-]?\s+(.+)$/);
      const seed = match ? Number(match[1]) : index + 1;
      const name = cleanName(match ? match[2] : line);
      if (!name) return null;
      return {
        id: `p_${seed}_${index}_${hashString(`${seed}|${index}|${name}`)}`,
        name,
        seed,
        originalIndex: index,
      };
    })
    .filter(Boolean);
}

function buildSlots(players, mode, randomSeed) {
  const bracketSize = nextPowerOfTwo(players.length);
  const emptySlots = Array.from({ length: bracketSize }, () => null);

  if (mode === "seeded") {
    const ranked = [...players].sort((a, b) => a.seed - b.seed || a.originalIndex - b.originalIndex);
    const order = seedOrder(bracketSize);
    return order.map((seedNumber) => ranked[seedNumber - 1] || null);
  }

  const rng = mulberry32(Number(randomSeed) || 1);
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (let i = 0; i < shuffled.length; i += 1) emptySlots[i] = shuffled[i];
  return emptySlots;
}

function encodeState(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeState(token) {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((token.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function readStateFromHash() {
  try {
    const rawHash = window.location.hash.replace(/^#/, "");
    if (!rawHash) return null;
    const params = new URLSearchParams(rawHash);
    const token = params.get("t");
    if (!token) return null;
    const data = decodeState(token);
    if (!data || data.v !== 2 || !Array.isArray(data.slots)) return null;
    return data;
  } catch (error) {
    return { error: true };
  }
}

function makeShareUrl(state) {
  const token = encodeState(state);
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return `${base}#t=${token}`;
}

function computeRounds(slots, winners) {
  const rounds = [];
  let current = slots;
  let roundIndex = 0;

  while (current.length > 1) {
    const matches = [];
    const next = [];

    for (let i = 0; i < current.length; i += 2) {
      const p1 = current[i] || null;
      const p2 = current[i + 1] || null;
      const key = `${roundIndex}-${i / 2}`;
      const selectedId = winners[key];
      let winner = null;
      let auto = false;

      // BYEによる自動通過は「1回戦だけ」に限定する
      // 2回戦以降の null は「前の試合の勝者待ち」なので、自動通過させない
      if (roundIndex === 0 && p1 && !p2) {
        winner = p1;
        auto = true;
      } else if (roundIndex === 0 && !p1 && p2) {
        winner = p2;
        auto = true;
      } else if (p1 && p2 && selectedId && (selectedId === p1.id || selectedId === p2.id)) {
        winner = selectedId === p1.id ? p1 : p2;
      }

      matches.push({ key, p1, p2, winner, auto, roundIndex, matchIndex: i / 2 });
      next.push(winner);
    }

    rounds.push(matches);
    current = next;
    roundIndex += 1;
  }

  return rounds;
}

function roundName(index, total) {
  if (index === total - 1) return "決勝";
  if (index === total - 2) return "準決勝";
  if (index === 0) return "1回戦";
  return `${index + 1}回戦`;
}

function roundClass(index, total) {
  if (index === total - 1) return "border-yellow-400 bg-yellow-50 shadow-yellow-200/70";
  if (index === total - 2) return "border-red-400 bg-red-50 shadow-red-200/70";
  return "border-slate-200 bg-white shadow-slate-200/60";
}

function PlayerButton({ player, opponent, winner, auto, disabled, onPick }) {
  if (!player) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400">
        BYE
      </div>
    );
  }

  const isWinner = winner?.id === player.id;
  const canPick = !disabled && opponent && !auto;

  return (
    <button
      type="button"
      disabled={!canPick}
      onClick={() => onPick(player)}
      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
        isWinner
          ? "border-emerald-400 bg-emerald-50 shadow-sm ring-2 ring-emerald-200"
          : canPick
          ? "border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{player.name}</div>
          <div className="text-xs text-slate-500">Seed #{player.seed}</div>
        </div>
        {isWinner && <Crown className="h-4 w-4 shrink-0 text-emerald-600" />}
      </div>
    </button>
  );
}

function ChampionCelebration({ champion }) {
  if (!champion) return null;
  const particles = Array.from({ length: 64 }, (_, i) => i);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative overflow-hidden rounded-3xl border border-yellow-300 bg-gradient-to-br from-yellow-50 via-white to-amber-100 p-6 shadow-2xl shadow-yellow-200/80"
    >
      <div className="pointer-events-none absolute inset-0">
        {particles.map((i) => {
          const left = `${(i * 37) % 100}%`;
          const delay = `${(i % 12) * 0.11}s`;
          const duration = `${2.4 + (i % 7) * 0.25}s`;
          const symbol = ["✦", "★", "✺", "●", "◆", "♛"][i % 6];
          return (
            <span
              key={i}
              className="absolute top-[-20px] animate-[confettiFall_linear_infinite] text-lg text-yellow-500"
              style={{ left, animationDelay: delay, animationDuration: duration }}
            >
              {symbol}
            </span>
          );
        })}
      </div>

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.div
          animate={{ rotate: [0, -8, 8, 0], scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 1.8 }}
          className="mb-3 rounded-full bg-yellow-200 p-5 shadow-xl shadow-yellow-300/60"
        >
          <Trophy className="h-16 w-16 text-yellow-700" />
        </motion.div>
        <div className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.25em] text-yellow-700">
          <Sparkles className="h-4 w-4" /> Champion <Sparkles className="h-4 w-4" />
        </div>
        <h2 className="text-4xl font-black text-slate-950 drop-shadow-sm">{champion.name}</h2>
        <p className="mt-2 text-sm font-medium text-slate-600">優勝おめでとう！</p>
      </div>
    </motion.div>
  );
}

export default function TournamentBracketShareTool() {
  const [title, setTitle] = useState("最強トーナメント");
  const [playersText, setPlayersText] = useState(SAMPLE_PLAYERS);
  const [mode, setMode] = useState("seeded");
  const [randomSeed, setRandomSeed] = useState(20260526);
  const [slots, setSlots] = useState(() => buildSlots(parsePlayers(SAMPLE_PLAYERS), "seeded", 20260526));
  const [winners, setWinners] = useState({});
  const [urlMessage, setUrlMessage] = useState("URLは自動で更新されます。共有は「共有URLをコピー」を使ってください。");
  const [loadedError, setLoadedError] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const load = () => {
      const data = readStateFromHash();
      if (!data) {
        hydratedRef.current = true;
        return;
      }
      if (data.error) {
        setLoadedError(true);
        hydratedRef.current = true;
        return;
      }
      setTitle(typeof data.title === "string" ? data.title : "トーナメント作成");
      setPlayersText(typeof data.playersText === "string" ? data.playersText : SAMPLE_PLAYERS);
      setMode(data.mode === "random" ? "random" : "seeded");
      setRandomSeed(Number(data.randomSeed) || 1);
      setSlots(Array.isArray(data.slots) ? data.slots : buildSlots(parsePlayers(SAMPLE_PLAYERS), "seeded", 20260526));
      setWinners(data.winners && typeof data.winners === "object" ? data.winners : {});
      setUrlMessage("共有URLから大会データを読み込みました。");
      hydratedRef.current = true;
    };

    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);

  const shareState = useMemo(
    () => ({
      v: 2,
      title,
      playersText,
      mode,
      randomSeed,
      slots,
      winners,
      savedAt: new Date().toISOString(),
    }),
    [title, playersText, mode, randomSeed, slots, winners]
  );

  useEffect(() => {
    if (!hydratedRef.current) return;
    const handle = window.setTimeout(() => {
      try {
        const url = makeShareUrl(shareState);
        window.history.replaceState(null, "", url);
        if (url.length > 12000) {
          setUrlMessage("参加者が多いためURLが長いです。コピー機能は使えますが、送信先アプリによっては短縮される可能性があります。");
        }
      } catch (error) {
        setUrlMessage("URL更新に失敗しました。参加者数や文字数を少し減らしてください。");
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [shareState]);

  const rounds = useMemo(() => computeRounds(slots, winners), [slots, winners]);
  const champion = rounds.length ? rounds[rounds.length - 1]?.[0]?.winner : null;
  const players = useMemo(() => parsePlayers(playersText), [playersText]);

  const createBracket = (forceRandomSeed = randomSeed) => {
    const parsed = parsePlayers(playersText);
    if (parsed.length < 2) {
      setUrlMessage("参加者を2人以上入力してください。");
      return;
    }
    const newSlots = buildSlots(parsed, mode, forceRandomSeed);
    setSlots(newSlots);
    setWinners({});
    setUrlMessage(mode === "seeded" ? "シード順位で配置しました。" : "ランダム配置を作成しました。");
  };

  const reshuffle = () => {
    const newSeed = Date.now() % 2147483647;
    setMode("random");
    setRandomSeed(newSeed);
    const parsed = parsePlayers(playersText);
    if (parsed.length >= 2) {
      setSlots(buildSlots(parsed, "random", newSeed));
      setWinners({});
      setUrlMessage("新しいランダム配置を作成しました。");
    }
  };

  const pickWinner = (match, player) => {
    if (!match.p1 || !match.p2 || match.auto) return;
    setWinners((prev) => ({ ...prev, [match.key]: player.id }));
    setUrlMessage(`${player.name}を勝者にしました。URLにも反映されます。`);
  };

  const copyShareUrl = async () => {
    try {
      const url = makeShareUrl(shareState);
      window.history.replaceState(null, "", url);
      await navigator.clipboard.writeText(url);
      setUrlMessage("共有URLをコピーしました。このURLを開くと、配置・勝敗・優勝者まで復元されます。");
    } catch (error) {
      const url = makeShareUrl(shareState);
      setUrlMessage(`コピーに失敗しました。下のURLを手動でコピーしてください：${url}`);
    }
  };

  const resetResults = () => {
    setWinners({});
    setUrlMessage("勝敗だけリセット。配置はそのままです。");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-blue-50 p-4 text-slate-900 md:p-8">
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(-30px) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(520px) rotate(720deg); opacity: 0; }
        }
      `}</style>

      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-200/70 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                <LinkIcon className="h-4 w-4" /> トーナメント表
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-2xl border border-transparent bg-transparent text-3xl font-black outline-none transition focus:border-blue-300 focus:bg-white focus:px-3 focus:py-2 md:text-5xl"
                aria-label="大会名"
              />
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
              
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyShareUrl}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-slate-300 transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                <Copy className="h-4 w-4" /> 共有URLをコピー
              </button>
              <button
                type="button"
                onClick={resetResults}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" /> 勝敗リセット
              </button>
            </div>
          </div>

          <AnimatePresence>
            {(urlMessage || loadedError) && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                  loadedError
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-blue-200 bg-blue-50 text-blue-800"
                }`}
              >
                <div className="flex gap-2">
                  {loadedError ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Save className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>{loadedError ? "URLデータを読み込めませんでした。新しく作成してください。" : urlMessage}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        <section className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <aside className="space-y-4 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xl shadow-slate-200/70 backdrop-blur">
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700">参加者リスト</label>
              <textarea
                value={playersText}
                onChange={(e) => setPlayersText(e.target.value)}
                className="h-64 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                placeholder="例：\n1. 佐藤\n2. 鈴木\n3. 田中"
              />
              <p className="mt-2 text-xs text-slate-500">
                「1. 名前」のように書くと、その数字をシード順位として扱います。数字なしなら上から順にシード扱いです。
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-sm font-bold text-slate-700">配置方法</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("seeded")}
                  className={`rounded-xl px-3 py-2 text-sm font-bold transition ${
                    mode === "seeded" ? "bg-blue-600 text-white shadow" : "bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  シード配置
                </button>
                <button
                  type="button"
                  onClick={() => setMode("random")}
                  className={`rounded-xl px-3 py-2 text-sm font-bold transition ${
                    mode === "random" ? "bg-blue-600 text-white shadow" : "bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  ランダム配置
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => createBracket()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-200 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                <Save className="h-4 w-4" /> 作成
              </button>
              <button
                type="button"
                onClick={reshuffle}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-purple-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-purple-200 transition hover:-translate-y-0.5 hover:bg-purple-700"
              >
                <Shuffle className="h-4 w-4" /> 再ランダム
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <div className="mb-2 font-bold text-slate-800">現在の設定</div>
              <div className="flex justify-between border-b border-slate-100 py-1">
                <span>参加者</span>
                <span className="font-bold">{players.length}人</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 py-1">
                <span>枠数</span>
                <span className="font-bold">{slots.length}枠</span>
              </div>
              <div className="flex justify-between py-1">
                <span>配置</span>
                <span className="font-bold">{mode === "seeded" ? "シード" : "ランダム"}</span>
              </div>
            </div>
          </aside>

          <main className="space-y-6">
            <ChampionCelebration champion={champion} />

            <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white/80 p-4 shadow-xl shadow-slate-200/70 backdrop-blur">
              <div className="flex min-w-max gap-4 pb-2">
                {rounds.map((round, roundIndex) => {
                  const total = rounds.length;
                  return (
                    <div key={roundIndex} className="w-72 shrink-0 space-y-3">
                      <div
                        className={`rounded-2xl border px-4 py-3 text-center shadow-sm ${roundClass(roundIndex, total)}`}
                      >
                        <div className="text-lg font-black">{roundName(roundIndex, total)}</div>
                        <div className="text-xs font-semibold text-slate-500">{round.length} match{round.length > 1 ? "es" : ""}</div>
                      </div>

                      <div className="space-y-4">
                        {round.map((match) => {
                          const isSemi = roundIndex === total - 2;
                          const isFinal = roundIndex === total - 1;
                          return (
                            <motion.div
                              key={match.key}
                              layout
                              className={`rounded-2xl border p-3 shadow-lg ${roundClass(roundIndex, total)}`}
                            >
                              <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
                                <span>{isFinal ? "FINAL" : isSemi ? "SEMI FINAL" : `MATCH ${match.matchIndex + 1}`}</span>
                                {match.auto && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">BYE通過</span>}
                              </div>

                              <div className="space-y-2">
                                <PlayerButton
                                  player={match.p1}
                                  opponent={match.p2}
                                  winner={match.winner}
                                  auto={match.auto}
                                  disabled={!match.p1 || !match.p2}
                                  onPick={(player) => pickWinner(match, player)}
                                />
                                <div className="text-center text-xs font-black text-slate-400">VS</div>
                                <PlayerButton
                                  player={match.p2}
                                  opponent={match.p1}
                                  winner={match.winner}
                                  auto={match.auto}
                                  disabled={!match.p1 || !match.p2}
                                  onPick={(player) => pickWinner(match, player)}
                                />
                              </div>

                              <div className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-600">
                                {match.winner
                                  ? `勝者：${match.winner.name}`
                                  : match.p1 && match.p2
                                  ? "勝者をクリックして選択"
                                  : "前の試合の勝者待ち"}
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </main>
        </section>
      </div>
    </div>
  );
}
