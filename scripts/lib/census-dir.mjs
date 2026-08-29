// Which directory under data/ holds the census the site is serving.
//
// There is exactly one live census at a time, and every half of the pipeline
// has to agree on which one it is: scan writes it, enrich fills it in, probe
// walks its endpoints, publish reads it, census-sync hands it to the worker,
// hire-confirm records against it. Before this file the directory was a default
// repeated in seven scripts, all of them still naming the first census — so the
// documented rule was "always pass --dir erc8004-v2", and on 28 August a scan
// launched without the flag spent nine minutes filling the dead directory
// instead. A default that has to be overridden every single time is not a
// default, it is a trap with a note next to it.
//
// A rescan still gets its own directory, which is what --dir is for: it runs
// into erc8004-v3 while the page keeps serving v2, and this constant moves over
// only once the new one is complete and published.
export const CENSUS_DIR = 'erc8004-v2';

// The flag every census script takes. Same spelling everywhere on purpose.
export function censusDirArg(argv = process.argv) {
  const i = argv.indexOf('--dir');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : CENSUS_DIR;
}
