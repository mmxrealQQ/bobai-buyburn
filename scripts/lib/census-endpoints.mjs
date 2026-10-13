// What the census counts as an http endpoint, and as one on a real top-level domain. Shared by the scan (which
// classifies each registration once) and the enrichment (which re-reads them every run and corrects the record when
// an agent changed its registration since the scan, 2026-10-13).
export const HTTP_RE = /^https?:\/\/[^\s"']+$/i;
export const REAL_TLD_RE = /\.(com|org|net|io|ai|xyz|app|dev|co|me|fun|finance|tech|cloud|so|gg|sh|to|it|de|fr|uk|eu|us|jp|kr|cn|in|ru|br|es|nl|se|no|fi|pl|ch|at|be|dk|cz|pt|gr|tr|za|au|nz|ca|mx|ar|cl|id|my|sg|th|vn|ph|hk|tw|ae|sa|il|info|biz|online|site|store|space|website|live|life|world|network|systems|digital|studio|agency|solutions|team|group|club|link|click|page|wiki|blog|news|press|art|design|money|market|exchange|capital|fund|trade|bot|chat|inc|ltd|llc)(:\d+)?(\/|$)/i;
