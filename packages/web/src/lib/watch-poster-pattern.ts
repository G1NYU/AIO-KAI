// Public image URL patterns only. Keep credentials out of artwork caches.
// PostersPlus public URL reference: UmbraProjects/PostersPlus/dev/URL_REFERENCE.md
// BetterPosters: btttr.cc/configure, documented public IMDb poster endpoint.
// The server-backed custom poster implementation is deliberately not used here:
/* eslint-disable lingui/no-unlocalized-strings -- provider URL syntax and protocol identifiers */
import type { CatalogPage } from './hosts/shell/stremio';
import { storage } from './storage';

type Item=Pick<CatalogPage['items'][number],'id'|'mediaType'|'poster'|'addonPoster'|'posterAlternatives'|'identities'|'imdbId'>;
export const POSTERS_PLUS_PATTERN='https://postersplus.cc/poster?tmdb_id={tmdb_id?}&imdb_id={imdb_id?}&stremio_id={id}&type={type}&shape={shape}';
export const BETTER_POSTERS_PATTERN='https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg';
const plusStyles=new Set(["_apa","_art","_asa","_asm","_ast","_ba","_bap","_bars","_bc","_bcs","_bcts","_bdm","_bf","_bfo","_bfs","_bfsr","_bg1","_bg2","_bg3","_bg4","_bgh","_bgo","_bgop","_bgr","_bh","_bhr","_blgs","_bls","_bo","_bof","_bp","_bqs","_bs","_bsa","_bsh","_bsoo10","_bst","_btc","_bw","_bx","_by","_cl","_fr","_gb","_gl","_grs","_gs","_hg","_hr","_hy","_ic","_ip","_is","_lp","_ls","_mo","_pc","_pp","_rb","_rbl","_rbm","_rbs","_rbst","_rmo","_rs","_scm","_scp","_sep","_sga","_sgb","_sgc","_sgt","_sm","_soo10","_sp","_stc","_tc","_tfo","_tfs","_tg","_tgh","_tgo","_tla","_trst","_ts","_tsc","_tsi","_tst","_tvso","_tx","_vcb","_vcl","_vcli","_vcr","_vcs","_vcsa","_vpcb","_vpct","_ws","abam","abbr","abfsr","abst","abyo","accent_bar_append_mode","accent_bar_bottom_ratio","accent_bar_font_size_ratio","accent_bar_style","accent_bar_y_offset","afs","ag","airing_dates","al","amw","anilist","anime_foreign_sash","anime_movie_weights","anime_provider_art","anime_tv_weights","apa","ard","art_gain","atw","ba","badge_anchor_x","badge_anchor_y","badge_cert_country","badge_cert_style","badge_cinema_style","badge_display_mode","badge_gap","badge_group1","badge_group2","badge_group3","badge_group4","badge_height","badge_legacy_style","badge_logo_scale","badge_logo_style","badge_min_score","badge_overflow","badge_pos","badge_quality_style","bap","bar_accent","bar_append","bar_bottom_inset","bar_font_size_ratio","bar_frost_opacity","bar_frost_saturation","bar_height_ratio","bar_score_out_of_10","bar_style","bax","bay","bbi","bcc","bcs","bcts","bdm","bfo","bfs","bfsr","bg","bg1","bg2","bg3","bg4","bgc","bgh","bgo","bgr","bh","bhr","blgs","bls","blst","bms","bof","bottom_gradient","bottom_gradient_curve","bottom_gradient_height","bottom_gradient_opacity","bp","bqs","bs","bsoo10","cbs","cg","cgsia","cgws","cinema_greyscale","cinema_greyscale_skip_if_available","cinema_greyscale_without_sash","combined_badge_stacked","fallback_bg_style","fallback_to_imdb","fbs","fr","frost_reference","fti","gl","gnq","greyscale_logo","greyscale_no_quality","greyscale_rating","grs","hg","hide_genre","hide_rating","hide_unreleased_rating","hide_year","hr","hur","hy","im","imdb","imdb_rating_source","irs","ki","kitsu","label_font","label_language","landscape_anime_provider_art","landscape_art","landscape_art_source_anime","landscape_art_source_movie","landscape_art_source_tv","landscape_badge_case","landscape_badge_cert_style","landscape_badge_cinema_style","landscape_badge_display_mode","landscape_badge_font","landscape_badge_glass_opacity","landscape_badge_group1","landscape_badge_group2","landscape_badge_group3","landscape_badge_group4","landscape_badge_height","landscape_badge_logo_scale","landscape_badge_logo_style","landscape_badge_opacity","landscape_badge_overflow","landscape_badge_pos","landscape_badge_quality_style","landscape_badge_saturation","landscape_badge_scale","landscape_badge_shape","landscape_badge_style","landscape_badge_text_color","landscape_badge_width","landscape_badge_x","landscape_badge_y","landscape_bar_accent","landscape_bar_append","landscape_bar_font_size_ratio","landscape_bar_frost_opacity","landscape_bar_frost_saturation","landscape_bar_height_ratio","landscape_bar_score_out_of_10","landscape_bar_style","landscape_bottom_gradient","landscape_bottom_gradient_height","landscape_bottom_gradient_opacity","landscape_color_link","landscape_frost_reference","landscape_graphic_badges","landscape_greyscale","landscape_greyscale_logo","landscape_greyscale_rating","landscape_hide_genre","landscape_hide_rating","landscape_hide_year","landscape_info_center","landscape_info_pos","landscape_info_scale","landscape_logo_pos","landscape_logo_scale","landscape_meta_order","landscape_poster_crop","landscape_poster_pick","landscape_rating_badge_list","landscape_rating_badge_max","landscape_rating_badge_scale","landscape_rating_badge_style","landscape_rating_badges","landscape_rating_mode","landscape_rating_separator","landscape_sash_mode","landscape_sash_priority","landscape_sash_text_color","landscape_score_color_mode","landscape_score_custom_palette","landscape_score_glow_alpha","landscape_score_glow_blur","landscape_score_glow_color","landscape_score_glow_threshold","landscape_score_out_of_10","landscape_separator","landscape_textless","landscape_top_gradient","landscape_top_gradient_height","landscape_top_gradient_opacity","landscape_top_vignette_sash_only","landscape_trending_corner","landscape_trending_frost_opacity","landscape_trending_frost_saturation","landscape_trending_label","landscape_trending_ribbon_style","landscape_trending_sash","landscape_trending_scale","landscape_trending_side","landscape_trending_style","landscape_vignette_color_blur","landscape_vignette_color_lightness","landscape_vignette_color_local","landscape_vignette_color_ramp","landscape_vignette_color_saturation","landscape_vignette_color_style","landscape_vignette_poster_color_bottom","landscape_vignette_poster_color_top","landscape_winner_star","lb","lba","lbr","letterboxd","lf","lfit","ll","lla","lls","lmhr","lmwr","logo_bottom_anchor","logo_bottom_ratio","logo_fit","logo_language","logo_language_secondary","logo_max_h_ratio","logo_max_w_ratio","logo_priority","logo_punch","logo_shadow","lp","lpu","lsh","mal","mam","mc","meta_order","metacritic","minimalist_append_mode","minimalist_center","minimalist_mode_font_size_ratio","minimalist_mode_font_x_offset","minimalist_mode_font_y_offset","minimalist_rating_separator","minimalist_score_out_of_10","minimalist_separator","mmfsr","mmfxo","mmfyo","mo","movie_weights","mrs","ms","msoo10","mu","muted","mw","myanimelist","notch_vignette_color","nsfsr","nsyo","numeric_score_font_size_ratio","numeric_score_y_offset","nvc","oas","ol","original_art_source","original_labels","pc","popcorn","poster_pick","poster_source_anime","poster_source_movie","poster_source_tv","poster_width","pp","primary_client","psa","psm","pst","pw","qad","quality_after_digital","rating_badge_kinds","rating_badge_max","rating_badge_scale","rating_badge_style","rating_badges","rating_display_mode","rating_text_color","rb","rbk","rbm","rbs","rbst","rdm","re","release_status_cinema_only","release_status_dates","res","resolution","rogerebert","rsco","rsd","rt","rtc","sas","sash_badge","sash_badge_font_ratio","sash_badge_frost_opacity","sash_badge_frost_saturation","sash_badge_inset","sash_badge_opacity","sash_badge_pad","sash_badge_pos","sash_badge_size_h","sash_badge_size_w","sash_badge_style","sash_chip_x","sash_chip_y","sash_edge_y","sash_height_ratio","sash_length_ratio","sash_mode","sash_poster_color","sash_priority","sash_side","sash_text_color","sash_winner_star","sb","sbfo","sbfr","sbfs","sbi","sbo","sbp","sbpo","sbs","sbsh","sbsw","scm","score_color_mode","score_custom_palette","score_glow_alpha","score_glow_blur","score_glow_color","score_glow_threshold","score_out_of_10","scp","scx","scy","sey","sga","sgb","sgc","sgt","show_award_sash","show_quality_badges","shr","slr","sm","soo10","sp","spc","sqb","ss","stc","sws","ta","tc","textless","tfo","tfs","tg","tgh","tgo","tk","tl","tla","tm","tmdb","tmdb_rating_source","tomatoes","top_gradient","top_gradient_height","top_gradient_opacity","top_vignette_sash_only","trakt","trending_align","trending_corner","trending_frost_opacity","trending_frost_saturation","trending_label","trending_list","trending_ribbon_style","trending_sash","trending_scale","trending_side","trending_style","trs","trst","ts","tsc","tsi","tst","tv_weights","tvso","tw","tx","uoa","use_original_art","vcb","vcl","vcli","vcr","vcs","vcsa","vignette_color_blur","vignette_color_lightness","vignette_color_local","vignette_color_ramp","vignette_color_saturation","vignette_color_style","vignette_poster_color_bottom","vignette_poster_color_top","vpcb","vpct","wait_for_quality","wfq","share","quality","textless","shape","type","resolution","tmdb_rating_source","imdb_rating_source","landscape_art_source","poster_pick","badge_pos","label_language"]);
const placeholders=new Set(['id','imdb_id','tmdb_id','mal_id','kitsu_id','anilist_id','type','shape']);
const marker=/\{([a-z_]+)(\?)?\}/g;
const imdb=/^tt[0-9]{1,12}$/;
const tmdb=/^tmdb:(?:(movie|tv):)?([1-9][0-9]{0,9})$/;
const anime=/^(mal|kitsu|anilist):([1-9][0-9]{0,9})$/;
const identityKeys=new Set(['imdb_id','tmdb_id','stremio_id']);
const identityMarker=(key:string,value:string)=>key==='stremio_id'?/^\{id\??\}$/.test(value):value==='{'+key+'}'||value==='{'+key+'?}';
const safeId=(id:string)=>imdb.test(id)||tmdb.test(id)||anime.test(id);
const validStyle=(value:string)=>value.length<=256&&/^[a-zA-Z0-9_.,:+%#() -]*$/.test(value);

/** Validate only public, documented portrait endpoint shapes. No userinfo,
 * ports, fragments, arbitrary hosts, credentials, or unknown query keys. */
export function validatePosterPattern(input:unknown):string|undefined{
  if(typeof input!=='string')return undefined;
  const raw=input.trim();
  if(!raw||raw.length>8192||/[\s\\]/.test(raw)||!raw.startsWith('https://'))return undefined;
  const matches=[...raw.matchAll(marker)];
  if(!matches.length||matches.some(m=>!placeholders.has(m[1]))||/[{}]/.test(raw.replace(marker,'')))return undefined;
  // URL parsing sees optional-placeholder question marks literally only
  // after tokens are encoded; preserve the pattern itself for substitution.
  const encoded=raw.replace(marker,m=>encodeURIComponent(m));
  try{
    const url=new URL(encoded);
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return undefined;
    const entries=[...url.searchParams.entries()];
    if(new Set(entries.map(([key])=>key)).size!==entries.length)return undefined;
    if(url.hostname==='postersplus.cc'){
      if(url.pathname!=='/poster'||!entries.some(([key,value])=>identityKeys.has(key)&&identityMarker(key,value)))return undefined;
      if(entries.some(([key,value])=>identityKeys.has(key)?!identityMarker(key,value):key==='type'? !['{type}','movie','series'].includes(value):key==='shape'?!['{shape}','poster','portrait'].includes(value):!plusStyles.has(key)||!validStyle(value)))return undefined;
      return raw;
    }
    if(url.hostname==='btttr.cc'){
      const path=decodeURIComponent(url.pathname);
      if(!/^\/poster\/imdb\/poster-(?:default|[grn]q?a?)\/\{imdb_id\}\.jpg$/.test(path))return undefined;
      if(entries.some(([key,value])=>key==='tag'?value!=='none':key==='lang'?!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value):key==='rs'?!/^(IM|TM|RT|MC|LB|RE)$/.test(value):true))return undefined;
      return raw;
    }
  }catch{}
  return undefined;
}
export function customPosterUrl(pattern:string|undefined,item:Item):string|undefined{
  if(!pattern)return undefined;
  const checked=validatePosterPattern(pattern);
  if(!checked)return undefined;
  const type=item.mediaType==='movie'||item.mediaType==='anime.movie'?'movie':item.mediaType==='series'||item.mediaType==='anime.series'||item.mediaType==='anime'?'series':undefined;
  if(!type)return undefined;
  const ids=[item.id,item.imdbId??'',...(item.identities??[])];
  const imdbId=ids.find(id=>imdb.test(id));
  const tmdbId=ids.map(id=>tmdb.exec(id)).find(match=>match&&(!match[1]||match[1]===(type==='movie'?'movie':'tv')))?.[2];
  const animeIds=ids.map(id=>anime.exec(id));
  const animeId=(kind:string)=>animeIds.find(match=>match?.[1]===kind)?.[2];
  const primary=safeId(item.id)&&(!tmdb.test(item.id)||!!tmdbId)?item.id:imdbId??(tmdbId?'tmdb:'+tmdbId:undefined);
  if(!imdbId&&!tmdbId&&!animeIds.some(Boolean))return undefined;
  const values:Record<string,string|undefined>={id:primary,imdb_id:imdbId,tmdb_id:tmdbId,mal_id:animeId('mal'),kitsu_id:animeId('kitsu'),anilist_id:animeId('anilist'),type,shape:'poster'};
  let missing=false;
  const result=checked.replace(marker,(_match,key:string,optional:string|undefined)=>{
    const value=values[key];
    if(!value&&!optional)missing=true;
    return value?encodeURIComponent(value):'';
  });
  if(missing)return undefined;
  // A template with only optional identifiers must actually resolve one.
  const url=new URL(result);
  if(url.hostname==='postersplus.cc'){
    if(![...url.searchParams].some(([key,value])=>identityKeys.has(key)&&!!value))return undefined;
    for(const key of identityKeys)if(url.searchParams.get(key)==='')url.searchParams.delete(key);
    return url.href;
  }
  return result;
}
export function watchPosterSources(item:Item,pattern?:string,preferred?:string):string[]{
  return [...new Set([customPosterUrl(pattern,item),item.addonPoster,item.poster,preferred,...(item.posterAlternatives??[])].filter((value):value is string=>!!value))];
}
export function readPosterPattern(profileId:number|undefined):string|undefined{
  return profileId===undefined?undefined:validatePosterPattern(storage.get('tsugi-watch-poster-pattern-v1:'+profileId));
}
export function writePosterPattern(profileId:number,pattern:string|undefined):boolean{
  const key='tsugi-watch-poster-pattern-v1:'+profileId;
  if(!pattern){storage.remove(key);return true;}
  const checked=validatePosterPattern(pattern);
  if(!checked)return false;
  storage.set(key,checked);
  return true;
}
/* eslint-enable lingui/no-unlocalized-strings */
