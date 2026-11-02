/**
 * Hand-written expectations for tone placement. Each row is
 * [classic style, modern style]; rows where both are equal cover the cases
 * that must not move (syllables with a coda, modified vowels, diphthongs,
 * the qu and gi onsets).
 */
export const TONE_PAIRS: ReadonlyArray<readonly [classic: string, modern: string]> = [
  // oa: open syllables differ
  ['hòa', 'hoà'], ['hóa', 'hoá'], ['hỏa', 'hoả'], ['họa', 'hoạ'], ['hõa', 'hoã'],
  ['tòa', 'toà'], ['tỏa', 'toả'], ['xòa', 'xoà'], ['lòa', 'loà'], ['chóa', 'choá'],
  ['đóa', 'đoá'], ['góa', 'goá'], ['khóa', 'khoá'], ['tóa', 'toá'], ['lọa', 'loạ'],
  // oe
  ['khỏe', 'khoẻ'], ['khòe', 'khoè'], ['khóe', 'khoé'], ['xòe', 'xoè'], ['hòe', 'hoè'],
  ['lóe', 'loé'], ['họe', 'hoẹ'], ['chóe', 'choé'],
  // uy
  ['thủy', 'thuỷ'], ['thúy', 'thuý'], ['thùy', 'thuỳ'], ['thụy', 'thuỵ'], ['húy', 'huý'],
  ['hủy', 'huỷ'], ['tùy', 'tuỳ'], ['túy', 'tuý'], ['lũy', 'luỹ'], ['ngụy', 'nguỵ'],
  ['ủy', 'uỷ'], ['úy', 'uý'], ['thũy', 'thuỹ'],
  // coda: the tone always sits on the second letter
  ['hoàn', 'hoàn'], ['toán', 'toán'], ['khoảng', 'khoảng'], ['hoạt', 'hoạt'], ['loạn', 'loạn'],
  ['huýt', 'huýt'], ['huỳnh', 'huỳnh'], ['khuỵch', 'khuỵch'], ['xoáy', 'xoáy'],
  // glide + modified vowel
  ['ngoằn', 'ngoằn'], ['hoặc', 'hoặc'], ['ngoắt', 'ngoắt'], ['tuần', 'tuần'], ['khuấy', 'khuấy'],
  ['thuế', 'thuế'], ['huế', 'huế'], ['tuệ', 'tuệ'], ['thuở', 'thuở'], ['huyền', 'huyền'],
  ['nguyễn', 'nguyễn'], ['khuyên', 'khuyên'],
  // three vowels
  ['loại', 'loại'], ['khoái', 'khoái'], ['ngoài', 'ngoài'], ['xoay', 'xoay'], ['quay', 'quay'],
  ['khuỷu', 'khuỷu'], ['ngoẹo', 'ngoẹo'],
  // qu onset: the u is part of the onset
  ['quý', 'quý'], ['quỳ', 'quỳ'], ['quả', 'quả'], ['quá', 'quá'], ['quốc', 'quốc'],
  ['quán', 'quán'], ['quyền', 'quyền'], ['quỹ', 'quỹ'], ['quê', 'quê'], ['quân', 'quân'],
  // gi onset
  ['giá', 'giá'], ['giường', 'giường'], ['gì', 'gì'], ['giữ', 'giữ'], ['giúp', 'giúp'],
  ['giếng', 'giếng'], ['gìn', 'gìn'], ['giải', 'giải'], ['giờ', 'giờ'],
  // diphthongs and centring diphthongs
  ['người', 'người'], ['tiếng', 'tiếng'], ['mưa', 'mưa'], ['múa', 'múa'], ['mía', 'mía'],
  ['cười', 'cười'], ['rượu', 'rượu'], ['chuối', 'chuối'], ['yêu', 'yêu'], ['yến', 'yến'],
  ['biển', 'biển'], ['muốn', 'muốn'], ['đường', 'đường'], ['hải', 'hải'], ['tôi', 'tôi'],
  ['đời', 'đời'], ['bầu', 'bầu'], ['kêu', 'kêu'], ['líu', 'líu'], ['hưu', 'hưu'], ['hữu', 'hữu'],
  ['ơi', 'ơi'], ['bây', 'bây'], ['tay', 'tay'], ['mèo', 'mèo'], ['của', 'của'], ['ừ', 'ừ'],
];
