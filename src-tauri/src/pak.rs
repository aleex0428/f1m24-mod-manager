// ─── pak.rs — Reading what is actually inside a mod ─────────────
//
// Conflict detection used to work on pakchunk numbers, which is a proxy rather
// than an answer: two mods claiming chunk 99 may touch entirely different
// files, and two mods on different chunks may both replace the same asset. The
// first is a false alarm, the second is a real clash that went unreported.
//
// A `.pak` is an Unreal container whose index lists every file it holds. That
// index is what this module reads. Verified against real F1 Manager 24 mods:
// version 11, unencrypted, with a full directory index giving exact paths.
//
// **Everything here returns `None` rather than guessing.** An unreadable
// container is not an error and not an empty mod — it is "we cannot tell", and
// the caller falls back to comparing pakchunks and says the answer is an
// estimate. That is what keeps this strictly better than what came before: it
// can add certainty, never remove it.

use std::path::Path;

/// Footer marker, little-endian `0x5A6F12E1`.
const PAK_MAGIC: [u8; 4] = [0xE1, 0x12, 0x6F, 0x5A];

/// How far back from the end to look for the footer. The footer is well under
/// this even with the largest compression-method table.
const FOOTER_SCAN: usize = 256;

/// The oldest layout this understands.
///
/// Version 10 introduced the full directory index — the part that maps names
/// to entries in a form worth reading. Earlier paks store a flat list whose
/// per-entry size depends on the compression blocks, and mis-parsing it would
/// silently produce wrong paths, which is worse than admitting we cannot read
/// it: the caller degrades to pakchunks and labels the result an estimate.
const MIN_VERSION: u32 = 10;

/// Every file a `.pak` contains, as paths relative to the game's content root.
///
/// `None` means "cannot tell": encrypted, too old, not shaped the way this
/// parser expects — or empty.
///
/// Empty counts as unreadable, and that is not pedantry. Mods shipping IoStore
/// containers put their real content in the `.ucas`/`.utoc` pair and leave a
/// stub `.pak` behind: it parses perfectly and lists nothing. Believing it
/// would mean concluding the mod touches no files and therefore conflicts with
/// nothing — a silent regression dressed up as certainty. A mod that genuinely
/// contains no files is not a thing worth modelling.
pub fn read_asset_paths(path: &Path) -> Option<Vec<String>> {
    let data = std::fs::read(path).ok()?;
    read_asset_paths_from(&data)
}

/// Split out so the parser can be tested without touching the filesystem.
pub fn read_asset_paths_from(data: &[u8]) -> Option<Vec<String>> {
    let tail_start = data.len().saturating_sub(FOOTER_SCAN);
    let tail = &data[tail_start..];

    // Scan backwards: the magic is near the end, and a later match is the real
    // footer if the payload happens to contain the same four bytes.
    let magic_at = find_last(tail, &PAK_MAGIC)?;

    // The encrypted flag sits immediately before the magic. An encrypted index
    // needs the game's AES key, which we do not have and should not want.
    if magic_at > 0 && tail[magic_at - 1] != 0 {
        return None;
    }

    let mut cursor = Cursor::new(tail, magic_at + PAK_MAGIC.len());
    let version = cursor.u32()?;
    if version < MIN_VERSION {
        return None;
    }

    let index_offset = cursor.u64()? as usize;
    let index_size = cursor.u64()? as usize;

    let index = data.get(index_offset..index_offset.checked_add(index_size)?)?;
    let mut idx = Cursor::new(index, 0);

    // Mount point is the path everything inside is relative to, e.g.
    // "../../../F1Manager24/Content/UIGameface/".
    let mount = idx.fstring()?;
    let _num_entries = idx.u32()?;
    let _path_hash_seed = idx.u64()?;

    if idx.u32()? != 0 {
        // Path hash index: offset, size, and a 20-byte hash we do not need.
        idx.skip(16 + 20)?;
    }

    // Without the directory index there are no names to read, only hashes.
    if idx.u32()? == 0 {
        return None;
    }
    let dir_offset = idx.u64()? as usize;
    let dir_size = idx.u64()? as usize;

    let dir = data.get(dir_offset..dir_offset.checked_add(dir_size)?)?;
    let mut d = Cursor::new(dir, 0);

    let num_dirs = d.u32()?;
    let mut paths = Vec::new();

    for _ in 0..num_dirs {
        let dir_name = d.fstring()?;
        let num_files = d.u32()?;
        for _ in 0..num_files {
            let file_name = d.fstring()?;
            d.skip(4)?; // index into the encoded entry table
            paths.push(normalise_asset_path(&mount, &dir_name, &file_name));
        }
    }

    // See the doc comment: an empty container is a stub beside an IoStore pair,
    // never a real answer.
    if paths.is_empty() {
        return None;
    }

    Some(paths)
}

/// Join the three pieces into one comparable path.
///
/// Comparison is the whole point, so the result has to be stable across mods
/// that spell the same location differently: the `../../../` a mount point
/// always carries is stripped, separators are normalised, and case is folded —
/// Unreal treats asset paths case-insensitively and two mods writing
/// `Content/UI/...` and `content/ui/...` are replacing the same file.
fn normalise_asset_path(mount: &str, dir: &str, file: &str) -> String {
    let mut joined = String::with_capacity(mount.len() + dir.len() + file.len());

    for part in [mount, dir] {
        let trimmed = part.trim_matches('/');
        if trimmed.is_empty() {
            continue;
        }
        joined.push_str(trimmed);
        joined.push('/');
    }
    joined.push_str(file.trim_matches('/'));

    joined
        .replace('\\', "/")
        .replace("../", "")
        .to_lowercase()
}

fn find_last(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    (0..=haystack.len() - needle.len())
        .rev()
        .find(|&i| &haystack[i..i + needle.len()] == needle)
}

/// A bounds-checked reader. Every method returns `None` past the end, so a
/// truncated or hostile file falls out of the parse instead of panicking —
/// this reads files the user downloaded from the internet.
struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8], pos: usize) -> Self {
        Self { data, pos }
    }

    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let slice = self.data.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }

    fn skip(&mut self, n: usize) -> Option<()> {
        self.take(n).map(|_| ())
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    /// Unreal's string: a length, then bytes. A negative length means UTF-16,
    /// and the count is of characters rather than bytes. Both include a
    /// terminator that is not part of the value.
    fn fstring(&mut self) -> Option<String> {
        let raw = i32::from_le_bytes(self.take(4)?.try_into().ok()?);

        if raw == 0 {
            return Some(String::new());
        }

        if raw > 0 {
            let bytes = self.take(raw as usize)?;
            let end = bytes.len().saturating_sub(1); // drop the NUL
            Some(String::from_utf8_lossy(&bytes[..end]).into_owned())
        } else {
            let chars = raw.checked_neg()? as usize;
            let bytes = self.take(chars.checked_mul(2)?)?;
            let units: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .take(chars.saturating_sub(1)) // drop the NUL
                .collect();
            Some(String::from_utf16_lossy(&units))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fstring(s: &str) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&((s.len() + 1) as i32).to_le_bytes());
        out.extend_from_slice(s.as_bytes());
        out.push(0);
        out
    }

    /// Build a pak shaped like the real ones: a directory index, an index that
    /// points at it, and a footer that points at the index.
    fn synthetic_pak(version: u32, encrypted: bool, entries: &[(&str, &str)]) -> Vec<u8> {
        let mut dir = Vec::new();
        dir.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        for (folder, file) in entries {
            dir.extend_from_slice(&fstring(folder));
            dir.extend_from_slice(&1u32.to_le_bytes()); // one file in this folder
            dir.extend_from_slice(&fstring(file));
            dir.extend_from_slice(&0u32.to_le_bytes()); // entry index
        }

        let mut data: Vec<u8> = vec![0xAB; 64]; // payload the index sits after

        let dir_offset = data.len();
        data.extend_from_slice(&dir);

        let index_offset = data.len();
        let mut index = Vec::new();
        index.extend_from_slice(&fstring("../../../F1Manager24/Content/"));
        index.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        index.extend_from_slice(&0u64.to_le_bytes()); // path hash seed
        index.extend_from_slice(&0u32.to_le_bytes()); // no path hash index
        index.extend_from_slice(&1u32.to_le_bytes()); // has full directory index
        index.extend_from_slice(&(dir_offset as u64).to_le_bytes());
        index.extend_from_slice(&(dir.len() as u64).to_le_bytes());
        index.extend_from_slice(&[0u8; 20]); // hash
        let index_size = index.len();
        data.extend_from_slice(&index);

        data.push(if encrypted { 1 } else { 0 });
        data.extend_from_slice(&PAK_MAGIC);
        data.extend_from_slice(&version.to_le_bytes());
        data.extend_from_slice(&(index_offset as u64).to_le_bytes());
        data.extend_from_slice(&(index_size as u64).to_le_bytes());
        data.extend_from_slice(&[0u8; 20]);
        data
    }


    #[test]
    fn reads_the_paths_out_of_a_pak() {
        let pak = synthetic_pak(
            11,
            false,
            &[("UI/RaceStandings", "RaceStandings.css"), ("UI/RaceStandings", "Row.css")],
        );

        let paths = read_asset_paths_from(&pak).expect("a v11 pak is readable");
        assert_eq!(
            paths,
            vec![
                "f1manager24/content/ui/racestandings/racestandings.css",
                "f1manager24/content/ui/racestandings/row.css",
            ],
            "mount point joined, ../ stripped, lowercased for comparison"
        );
    }

    /// The case real files taught us: a mod whose content lives in a
    /// `.ucas`/`.utoc` pair leaves a `.pak` that parses cleanly and lists
    /// nothing. Reported as unreadable, or conflict detection would decide it
    /// touches nothing and clear every clash it is part of.
    #[test]
    fn an_empty_container_is_not_an_answer() {
        let stub = synthetic_pak(11, false, &[]);
        assert!(read_asset_paths_from(&stub).is_none());
    }

    /// The three ways a container is unreadable. Each must be `None` — not an
    /// empty list, which would read as "this mod contains nothing" and quietly
    /// clear every conflict it was involved in.
    #[test]
    fn unreadable_containers_say_so_instead_of_guessing() {
        let encrypted = synthetic_pak(11, true, &[("UI", "a.css")]);
        assert!(read_asset_paths_from(&encrypted).is_none(), "encrypted index");

        let ancient = synthetic_pak(8, false, &[("UI", "a.css")]);
        assert!(read_asset_paths_from(&ancient).is_none(), "pre-directory-index format");

        assert!(read_asset_paths_from(b"not a pak at all").is_none(), "no footer");
    }

    /// Real files get truncated by a failed download and by half-finished
    /// copies. Every read is bounds-checked, so this must return rather than
    /// panic, whichever byte it stops at.
    #[test]
    fn a_truncated_pak_never_panics() {
        let pak = synthetic_pak(11, false, &[("UI", "a.css")]);
        for cut in 0..pak.len() {
            let _ = read_asset_paths_from(&pak[..cut]);
        }
    }

    #[test]
    fn utf16_names_survive_the_round_trip() {
        let mut cursor_data = Vec::new();
        let text = "Ferrari";
        let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        cursor_data.extend_from_slice(&(-(units.len() as i32)).to_le_bytes());
        for unit in &units {
            cursor_data.extend_from_slice(&unit.to_le_bytes());
        }

        let mut cursor = Cursor::new(&cursor_data, 0);
        assert_eq!(cursor.fstring().unwrap(), text);
    }
}
