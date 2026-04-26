export default function App() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-br from-blue-100 via-indigo-100 to-fuchsia-100/90 dark:from-slate-950 dark:via-indigo-950 dark:to-violet-950">
      {/* Decorative background elements */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 -left-32 h-96 w-96 rounded-full bg-blue-400/35 blur-3xl dark:bg-blue-500/25" />
        <div className="absolute bottom-1/4 -right-32 h-96 w-96 rounded-full bg-fuchsia-400/30 blur-3xl dark:bg-violet-500/20" />
        <div className="absolute top-1/2 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-400/25 blur-3xl dark:bg-indigo-500/20" />
      </div>

      <main className="relative z-10 mx-auto flex w-full min-h-dvh max-w-7xl flex-1 flex-col px-5 pt-[25rem] text-center sm:px-6 md:pt-[25rem]">
        <div className="relative flex w-full flex-1 flex-col items-center">
          <div className="w-full max-w-xl animate-[fadeIn_0.6s_ease-out]">
            <h1 className="text-6xl md:text-7xl font-serif font-medium tracking-tight mb-4 bg-gradient-to-br from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 bg-clip-text text-transparent">
              kandor
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-300 leading-relaxed mx-auto">
              a chrome extension that protects you and your child from
              manipulators, scammers, groomers, and other online threats.
            </p>
          </div>

          <a
            href="#"
            className="inline-flex items-center justify-center px-8 py-3 mt-10 text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl font-light shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-[1.02] transition-all duration-200 animate-[fadeIn_0.6s_ease-out_0.2s_both]"
          >
            add to chrome
          </a>

          <section
            className="mt-20 w-full md:mt-100"
            aria-labelledby="demo-preview-heading"
          >
            <div className="grid w-full grid-cols-1 items-center gap-10 md:grid-cols-5 md:items-center md:gap-8 lg:gap-10">
              <div className="flex min-h-0 flex-col justify-center gap-6 text-left md:col-span-2 md:gap-7 md:pr-2 lg:pr-4">
                <h2
                  id="demo-preview-heading"
                  className="font-serif text-2xl font-medium tracking-tight text-gray-900 dark:text-white md:text-3xl lg:text-[2rem] lg:leading-snug"
                >
                  Detect malicious conversations
                </h2>
                <p className="text-base leading-relaxed text-gray-600 dark:text-gray-300 md:text-[1.0625rem] md:leading-[1.75]">
                  Kandor scans supported social pages in Chrome for signs of
                  manipulation, grooming, and other online threats. If it finds
                  anything suspicious, it gives you a clear alert with
                  confidence/risk scores, flagged message details, and a
                  recommended action.
                </p>
              </div>

              <div className="relative flex w-full min-w-0 items-center justify-center py-1 md:col-span-3 md:min-h-[min(26rem,62vh)] md:justify-end">
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[min(48rem,125%)] w-[min(64rem,130%)] max-w-[220%] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_70%_55%_at_50%_50%,rgb(99,102,241,0.55),rgb(59,130,246,0.4),rgb(124,58,237,0.3)_45%,rgb(30,64,175,0.12)_58%,transparent_72%)] dark:bg-[radial-gradient(ellipse_68%_52%_at_50%_50%,rgb(99,102,241,0.5),rgb(37,99,235,0.4),rgb(109,40,217,0.32)_48%,rgb(30,27,75,0.35)_60%,transparent_74%)]"
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-96 w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-[3rem] bg-gradient-to-br from-indigo-500/45 via-blue-500/40 to-fuchsia-500/45 opacity-90 blur-3xl dark:from-indigo-500/50 dark:via-violet-600/45 dark:to-blue-600/40"
                  aria-hidden
                />
                <picture className="relative z-10 w-full max-w-3xl sm:max-w-4xl md:max-w-none">
                  <img
                    src="/hacktech-demo.png"
                    width={1875}
                    height={1905}
                    className="h-auto w-full rounded-xl shadow-[0_24px_60px_-12px_rgba(67,56,202,0.3),0_8px_24px_rgba(15,23,42,0.14)] dark:shadow-[0_28px_64px_-12px_rgba(99,102,241,0.35),0_8px_24px_rgba(0,0,0,0.35)]"
                    alt="Kandor extension demo showing a safety alert in the browser"
                  />
                </picture>
              </div>
            </div>
          </section>
        </div>

        <footer className="mt-auto w-full border-t border-gray-200/50 py-6 dark:border-white/10 pt-50">
          <p className="font-serif text-sm font-medium tracking-tight text-gray-500 dark:text-gray-400">
            kandor.
          </p>
        </footer>
      </main>

      <picture className="absolute top-[10rem] left-[0rem] z-10 w-lg">
        <img
          src="/8-tree-drawing-8.png"
          width={(1875 * 2) / 5}
          height={(1905 * 2) / 5}
          className="h-auto w-full"
        />
      </picture>
      <picture className="absolute top-[10rem] right-[-5rem] z-10 w-2xl">
        <img
          src="/8-tree-drawing-6.png"
          width={(1875 * 2) / 5}
          height={(1905 * 2) / 5}
          className="h-auto w-full"
        />
      </picture>
    </div>
  );
}
