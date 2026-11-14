use regex::Regex;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

pub(super) fn normalized(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

pub(super) fn title_numbers(value: &str) -> Vec<String> {
    static NUMBERS: OnceLock<Regex> = OnceLock::new();
    let numbers = NUMBERS.get_or_init(|| {
        Regex::new(
            r"(?i)\b(?:part|pt|vol|volume|no|chapter|movement|act)\.?\s+([ivxlcdm]+)\b|[0-9]+",
        )
        .unwrap()
    });
    let value = value.nfkc().collect::<String>();
    numbers
        .captures_iter(&value)
        .map(|capture| {
            if let Some(roman) = capture.get(1) {
                return roman.as_str().to_lowercase();
            }
            let digits = capture[0].trim_start_matches('0');
            if digits.is_empty() {
                "0".into()
            } else {
                digits.into()
            }
        })
        .collect()
}

fn brackets() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\(([^()]*)\)|\[([^\[\]]*)\]|【([^【】]*)】").unwrap())
}

fn credits() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?i)\b(?:feat\.?|ft\.?|featuring)\s+(.+)$").unwrap())
}

fn remaster(value: &str) -> bool {
    let value = value.to_lowercase();
    value.contains("remaster") || value.contains("重制") || value.contains("リマスター")
}

pub(super) fn versions(value: &str) -> Vec<&'static str> {
    static LATIN: OnceLock<Regex> = OnceLock::new();
    let latin = LATIN.get_or_init(|| Regex::new(r"(?i)\b(live|instrumental|karaoke|inst|remix|cover|acoustic|unplugged|cantonese|mandarin|radio\s+edit|tv\s+size|short\s+ver(?:sion)?|extended|sped\s+up|slowed)\b").unwrap());
    let value = value.nfkc().collect::<String>().to_lowercase();
    let mut result = Vec::new();
    for captures in latin.captures_iter(&value) {
        let word = &captures[1];
        result.push(match word {
            "live" => "现场",
            "instrumental" | "karaoke" | "inst" => "伴奏",
            "remix" => "混音",
            "cover" => "翻唱",
            "acoustic" | "unplugged" => "不插电",
            "cantonese" => "粤语",
            "mandarin" => "国语",
            "extended" => "加长版",
            _ if word.starts_with("radio") => "电台版",
            _ if word.starts_with("tv") || word.starts_with("short") => "短版",
            _ if word.starts_with("sped") => "加速版",
            _ => "减速版",
        });
    }
    for (tag, terms) in [
        ("现场", &["现场", "現場", "演唱会", "演唱會"][..]),
        (
            "伴奏",
            &["伴奏", "カラオケ", "オフボーカル", "off vocal"][..],
        ),
        ("混音", &["混音"][..]),
        ("翻唱", &["翻唱"][..]),
        ("不插电", &["不插电", "不插電"][..]),
        ("粤语", &["粤语", "粵語"][..]),
        ("国语", &["国语", "國語", "chinese ver"][..]),
        ("日语", &["日语", "日語", "japanese ver"][..]),
        ("韩语", &["韩语", "韓語", "korean ver"][..]),
    ] {
        if terms.iter().any(|term| value.contains(term)) {
            result.push(tag);
        }
    }
    result.sort_unstable();
    result.dedup();
    result
}

fn different_script(a: &str, b: &str) -> bool {
    let kana = |v: &str| v.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c));
    let han = |v: &str| v.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c));
    let latin = |v: &str| v.chars().any(|c| c.is_ascii_alphabetic());
    // Alternate-script labels can be aliases; numbers and same-script subtitles stay significant.
    (kana(a) && !kana(b) && han(b))
        || (kana(b) && !kana(a) && han(a))
        || ((kana(a) || han(a)) && !kana(b) && !han(b) && latin(b))
        || ((kana(b) || han(b)) && !kana(a) && !han(a) && latin(a))
}

fn push_key(keys: &mut Vec<String>, value: &str) {
    let value = normalized(value);
    if !value.is_empty() && !keys.contains(&value) {
        keys.push(value);
    }
}

pub(super) fn title_keys(value: &str) -> Vec<String> {
    let value = value.nfkc().collect::<String>();
    let mut keys = Vec::new();
    push_key(&mut keys, &value);
    let base = brackets().replace_all(&value, " ");
    let parts: Vec<_> = brackets()
        .captures_iter(&value)
        .filter_map(|c| c.iter().skip(1).flatten().next().map(|m| m.as_str()))
        .collect();
    if !parts.is_empty()
        && parts.iter().all(|part| {
            credits().is_match(part)
                || !versions(part).is_empty()
                || remaster(part)
                || different_script(&base, part)
        })
    {
        push_key(&mut keys, &base);
        for part in parts {
            if !credits().is_match(part)
                && versions(part).is_empty()
                && !remaster(part)
                && different_script(&base, part)
            {
                push_key(&mut keys, part);
            }
        }
    }
    let without_credits = brackets().replace_all(&value, |captures: &regex::Captures<'_>| {
        let part = captures.iter().skip(1).flatten().next().unwrap().as_str();
        if credits().is_match(part) {
            " ".to_string()
        } else {
            captures[0].to_string()
        }
    });
    push_key(&mut keys, &without_credits);
    if let Some(credit) = credits().find(&without_credits) {
        push_key(&mut keys, &without_credits[..credit.start()]);
    }
    if let Some((title, suffix)) = value.rsplit_once(" - ") {
        if !versions(suffix).is_empty() || remaster(suffix) {
            push_key(&mut keys, title);
        }
    }
    keys
}

fn artist_key(value: &str) -> String {
    let key = normalized(value);
    match key.as_str() {
        "初音未来" | "初音未來" | "初音ミク" | "hatsunemiku" => "hatsunemiku".into(),
        _ => key,
    }
}

pub(super) fn artist_keys(artists: &[String], title: &str) -> Vec<Vec<String>> {
    static SPLIT: OnceLock<Regex> = OnceLock::new();
    let split = SPLIT.get_or_init(|| {
        Regex::new(r"(?i)[;,/、&；]|\s+(?:feat\.?|ft\.?|featuring|with)\s+").unwrap()
    });
    let mut names = artists.to_vec();
    if let Some(credit) = credits().captures(&title.nfkc().collect::<String>()) {
        names.push(credit[1].trim_end_matches([')', ']']).to_string());
    }
    let mut result = Vec::new();
    for name in names {
        let name = name.nfkc().collect::<String>();
        for part in split.split(&name) {
            if matches!(
                normalized(part).as_str(),
                "" | "未知歌手" | "unknown" | "unknownartist" | "variousartists"
            ) {
                continue;
            }
            let base = brackets().replace_all(part, " ");
            let mut keys = vec![artist_key(part)];
            let aliases: Vec<_> = brackets()
                .captures_iter(part)
                .filter_map(|c| c.iter().skip(1).flatten().next().map(|m| m.as_str()))
                .collect();
            if aliases.iter().all(|alias| {
                alias.to_lowercase().starts_with("cv")
                    || credits().is_match(alias)
                    || different_script(&base, alias)
                    || artist_key(&base) == artist_key(alias)
            }) {
                keys.push(artist_key(&base));
            }
            for captures in brackets().captures_iter(part) {
                let alias = captures.iter().skip(1).flatten().next().unwrap().as_str();
                // A role credit is another person, not an alias of this artist.
                if !alias.to_lowercase().starts_with("cv")
                    && !credits().is_match(alias)
                    && versions(alias).is_empty()
                    && (different_script(&base, alias) || artist_key(&base) == artist_key(alias))
                {
                    keys.push(artist_key(alias));
                }
            }
            keys.retain(|key| !key.is_empty());
            keys.sort_unstable();
            keys.dedup();
            if !keys.is_empty() && !result.contains(&keys) {
                result.push(keys);
            }
        }
    }
    result
}
