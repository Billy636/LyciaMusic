#[path = "../src/music/lyrics.rs"]
mod lyrics;

use lyrics::build_structured_lyrics_payload;

fn find_display_line_by_time(
    payload: &lyrics::StructuredLyricsPayload,
    time: f64,
) -> Option<&lyrics::LyricLinePayload> {
    payload
        .display_lines
        .iter()
        .find(|line| (line.time - time).abs() < 0.001)
}

#[test]
fn parses_yrc_fixture_payload() {
    let payload = build_structured_lyrics_payload(
        include_str!("../src/music/fixtures/lyrics/if_back_then.yrc").to_string(),
    );

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(payload.display_lines[0].text, "如果当时 - 许嵩");
    assert_eq!(
        payload.display_lines[0]
            .words
            .as_ref()
            .map(|words| words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>())
            .unwrap_or_default(),
        vec!["如", "果", "当", "时", " ", "-", " ", "许", "嵩"]
    );
    assert_eq!(payload.display_lines[1].text, "词：许嵩");
}

#[test]
fn parses_qrc_fixture_payload() {
    let payload = build_structured_lyrics_payload(
        include_str!("../src/music/fixtures/lyrics/baby.qrc").to_string(),
    );

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(
        payload.display_lines[0].text,
        "You know you love me I know you care"
    );
    assert_eq!(payload.display_lines[1].text, "你知道你爱我 我知道你在意");
}

#[test]
fn parses_lys_fixture_payload() {
    let payload = build_structured_lyrics_payload(
        include_str!("../src/music/fixtures/lyrics/from_that_day.lys").to_string(),
    );

    assert_eq!(payload.display_lines.len(), 2);
    assert_eq!(payload.display_lines[0].text, "その日から何もかも");
    assert_eq!(payload.display_lines[1].text, "忘れたくないこと");
}

#[test]
fn keeps_bilingual_english_lines_as_single_display_rows() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:22.26]Hey you",
            "[00:22.26]嘿 亲爱的",
            "[00:25.15]I wrote these words",
            "[00:25.15]我写下这些字句",
            "[00:26.73]Got something to say to you",
            "[00:26.73]有些话想对你说",
            "[00:30.66]Lovers turn to strangers",
            "[00:30.66]恋人终成陌路",
            "[00:32.71]But they stay fools stay fools",
            "[00:32.71]但痴心人依然执迷不悟",
        ]
        .join("\n"),
    );

    assert_eq!(payload.display_lines.len(), 5);
    assert_eq!(
        payload
            .display_lines
            .iter()
            .map(|line| (line.time * 1000.0).round() as i64)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        payload.display_lines.len(),
    );
    assert_eq!(payload.display_lines[0].text, "Hey you");
    assert_eq!(payload.display_lines[0].translation, "嘿 亲爱的");
    assert!(payload
        .display_lines
        .iter()
        .all(|line| line.romaji.is_empty()));
}

#[test]
fn keeps_japanese_romaji_and_translation_grouped_for_short_lines() {
    let payload = build_structured_lyrics_payload(
        [
            "[04:50.560]<04:50.560>da i jo u bu ki mi wa hi to ri ja na i<04:52.500>",
            "[04:50.560]<04:50.560>大丈夫 君は一人じゃない<04:52.500>",
            "[04:50.560]<04:50.560>没问题 你不孤单<04:52.500>",
            "[04:53.260]<04:53.260>kyo u yo ri a shi ta wa tsu yo ku a re<04:55.590>",
            "[04:53.260]<04:53.260>今日より明日は 強くあれ<04:55.590>",
            "[04:53.260]<04:53.260>明天会比今天更坚强<04:55.590>",
            "[04:55.590]<04:55.590>i tsu de mo ki mi wa hi to ri ja na i<04:57.880>",
            "[04:55.590]<04:55.590>いつでも君は 一人じゃない<04:57.880>",
            "[04:55.590]<04:55.590>一直以来你都不孤单<04:57.880>",
            "[04:57.880]<04:57.880>ha ge ma shi a u na ka ma ga i ru<05:00.140>",
            "[04:57.880]<04:57.880>励まし合う 仲間がいる<05:00.140>",
            "[04:57.880]<04:57.880>有互相鼓励的朋友<05:00.140>",
            "[05:00.140]<05:00.140>da i jo u bu<05:01.270>",
            "[05:00.140]<05:00.140>大丈夫<05:01.270>",
            "[05:00.140]<05:00.140>没问题<05:01.270>",
            "[05:03.480]<05:03.480>ko re ka ra mo hi to ri ja na i<05:14.050>",
            "[05:03.480]<05:03.480>これからも 一人じゃない<05:14.050>",
            "[05:03.480]<05:03.480>从今往后你也不会孤单<05:14.050>",
            "[05:14.050]<05:14.050>o wa ri<05:15.050>",
            "[05:14.050]<05:14.050>終わり<05:15.050>",
            "[05:14.050]<05:14.050>终<05:15.050>",
        ]
        .join("\n"),
    );

    let short_line = find_display_line_by_time(&payload, 300.140).expect("short line exists");
    assert_eq!(short_line.text, "大丈夫");
    assert_eq!(short_line.romaji, "da i jo u bu");
    assert_eq!(short_line.translation, "没问题");

    let ending_line = find_display_line_by_time(&payload, 303.480).expect("ending line exists");
    assert_eq!(ending_line.text, "これからも 一人じゃない");
    assert_eq!(ending_line.romaji, "ko re ka ra mo hi to ri ja na i");
    assert_eq!(ending_line.translation, "从今往后你也不会孤单");

    let final_line = find_display_line_by_time(&payload, 314.050).expect("final line exists");
    assert_eq!(final_line.text, "終わり");
    assert_eq!(final_line.romaji, "o wa ri");
    assert_eq!(final_line.translation, "终");
}

#[test]
fn preserves_inline_english_main_lines_inside_japanese_song() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:20.699]<00:20.699>ha ji me te no ru bu ru wa<00:22.434>",
            "[00:20.699]<00:20.699>初めてのルーブルは<00:22.434>",
            "[00:20.699]<00:20.699>第一次参观卢浮宫<00:23.011>",
            "[00:23.011]<00:23.011>na n te ko to wa na ka tsu ta wa<00:25.100>",
            "[00:23.011]<00:23.011>なんてことはなかったわ<00:25.100>",
            "[00:23.011]<00:23.011>却并不觉得震撼<00:25.100>",
            "[00:25.100]<00:25.100>wa ta shi da ke no mo na ri za<00:26.828>",
            "[00:25.100]<00:25.100>私だけのモナリザ<00:26.828>",
            "[00:25.100]<00:25.100>因为我早已遇见<00:26.828>",
            "[00:26.942]<00:26.942>mo u to kku ni de a't te ta ka ra<00:29.044>",
            "[00:26.942]<00:26.942>もうとっくに出会ってたから<00:29.044>",
            "[00:26.942]<00:26.942>独属于我的蒙娜丽莎<00:29.374>",
            "[00:47.751]<00:47.751>(Can you give me one last kiss?)<00:52.399>",
            "[00:47.751]<00:47.751>(可以给我最后一个吻吗?)<00:52.399>",
            "[01:09.631]<01:09.631>I love you more than you'll ever know<01:12.607>",
            "[01:09.631]<01:09.631>我比你想象中更爱你<01:20.847>",
            "[01:20.847]<01:20.847>sha shi n wa ni ga te na n da<01:22.783>",
            "[01:20.847]<01:20.847>「写真は苦手なんだ」<01:22.783>",
            "[01:20.847]<01:20.847>“我不擅长摄影”<01:22.783>",
            "[01:26.907]<01:26.907>wa ta shi no ko ko ro no pu ro je ku ta<01:29.120>",
            "[01:26.907]<01:26.907>私の心のプロジェクター<01:29.120>",
            "[01:26.907]<01:26.907>早已将你的身影深深烙印<01:29.266>",
        ]
        .join("\n"),
    );

    let japanese_line = find_display_line_by_time(&payload, 26.942).expect("japanese line exists");
    assert_eq!(japanese_line.text, "もうとっくに出会ってたから");
    assert_eq!(japanese_line.romaji, "mo u to kku ni de a't te ta ka ra");
    assert_eq!(japanese_line.translation, "独属于我的蒙娜丽莎");

    let english_line = find_display_line_by_time(&payload, 47.751).expect("english line exists");
    assert_eq!(english_line.text, "(Can you give me one last kiss?)");
    assert_eq!(english_line.translation, "(可以给我最后一个吻吗?)");
    assert!(english_line.romaji.is_empty());

    let projector_line =
        find_display_line_by_time(&payload, 86.907).expect("projector line exists");
    assert_eq!(projector_line.text, "私の心のプロジェクター");
    assert_eq!(
        projector_line.romaji,
        "wa ta shi no ko ko ro no pu ro je ku ta"
    );
    assert_eq!(projector_line.translation, "早已将你的身影深深烙印");
}

#[test]
fn keeps_mixed_japanese_and_english_lines_as_main_when_no_romaji_track_exists() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:43.314]I don't know what I wanted or you made me do",
            "[00:43.314]我不知自己心之所向 亦不知你对我期望怎样",
            "[00:49.283]散り散りに刻む",
            "[00:49.283]于颠沛流离中铭刻下生命的印记",
            "[00:54.353]本当の世界で笑えるか?",
            "[00:54.353]在现实世界里还能够展颜欢笑吗",
            "[01:00.455]Don't you get there?",
            "[01:00.455]你是否还未抵达目的地？",
        ]
        .join("\n"),
    );

    let english_line = find_display_line_by_time(&payload, 43.314).expect("english line exists");
    assert_eq!(
        english_line.text,
        "I don't know what I wanted or you made me do"
    );
    assert_eq!(
        english_line.translation,
        "我不知自己心之所向 亦不知你对我期望怎样"
    );
    assert!(english_line.romaji.is_empty());

    let japanese_line = find_display_line_by_time(&payload, 49.283).expect("japanese line exists");
    assert_eq!(japanese_line.text, "散り散りに刻む");
    assert_eq!(japanese_line.translation, "于颠沛流离中铭刻下生命的印记");
    assert!(japanese_line.romaji.is_empty());

    let final_english_line =
        find_display_line_by_time(&payload, 60.455).expect("final english line exists");
    assert_eq!(final_english_line.text, "Don't you get there?");
    assert_eq!(final_english_line.translation, "你是否还未抵达目的地？");
    assert!(final_english_line.romaji.is_empty());
}

#[test]
fn keeps_french_lines_as_main_with_chinese_translation() {
    let payload = build_structured_lyrics_payload(
        [
            "[01:03.014]Et quand tu briseras ta cage",
            "[01:03.014]当你挣脱内心的牢笼",
            "[01:06.009]On ira a la foire",
            "[01:06.009]我们将一起前往那欢乐的圣地",
        ]
        .join("\n"),
    );

    let first_line = find_display_line_by_time(&payload, 63.014).expect("first french line exists");
    assert_eq!(first_line.text, "Et quand tu briseras ta cage");
    assert_eq!(first_line.translation, "当你挣脱内心的牢笼");
    assert!(first_line.romaji.is_empty());

    let second_line =
        find_display_line_by_time(&payload, 66.009).expect("second french line exists");
    assert_eq!(second_line.text, "On ira a la foire");
    assert_eq!(second_line.translation, "我们将一起前往那欢乐的圣地");
    assert!(second_line.romaji.is_empty());
}

#[test]
fn keeps_latin_main_when_chinese_translation_contains_repeated_latin_words() {
    let payload = build_structured_lyrics_payload(
        [
            "[by:燕如兮]",
            "[00:19.76]Deine Zeit ist da",
            "[00:19.76]正是出海的好时候",
            "[00:21.00]mach dich auf mein Jung",
            "[00:21.00]出发吧我的少年",
            "[00:22.21]denn die Segel sind gehisst.",
            "[00:22.21]船帆已经高悬",
            "[00:24.58]Seit ich denken kann",
            "[00:24.58]你是个好孩子",
            "[00:25.81]willst du mit uns fahr'n",
            "[00:25.81]来和我们一起航行",
            "[00:27.02]weit hinaus auf unsrem Schiff.",
            "[00:27.02]一起乘风破浪",
            "[00:29.62]Du bist alt genug",
            "[00:29.62]你已经是男子汉了",
            "[00:30.68]wenn du willst dann komm",
            "[00:30.68]你该有自己的选择",
            "[00:31.92]aber schnell wir laufen aus.",
            "[00:31.92]决定了就快跳上甲板",
            "[00:34.36]Junge eile dich",
            "[00:34.36]年轻人，别磨蹭",
            "[00:35.56]denn am Himmel ziehn",
            "[00:35.56]看一眼远方天际",
            "[00:37.02]dunkle Wolken auf.",
            "[00:37.02]浓云正在聚集",
            "[00:38.88]Johnny Boy, Johnny Boy",
            "[00:38.88]Johnny小子，Johnny小子！",
            "[00:41.62]we're bound for stormy weather",
            "[00:41.62]我们本就为风暴而生",
            "[00:43.66]Johnny Boy, Johnny Boy",
            "[00:43.66]Johnny小子，Johnny小子！",
            "[00:46.41]better wish you lads farewell",
            "[00:46.41]所有的祝福都给你",
            "[00:48.55]Somewhere out far away",
            "[00:48.55]在某个遥远海域",
        ]
        .join("\n"),
    );

    let first_refrain =
        find_display_line_by_time(&payload, 38.88).expect("first refrain line exists");
    let storm_line = find_display_line_by_time(&payload, 41.62).expect("storm line exists");
    let second_refrain =
        find_display_line_by_time(&payload, 43.66).expect("second refrain line exists");
    let farewell_line = find_display_line_by_time(&payload, 46.41).expect("farewell line exists");
    let faraway_line = find_display_line_by_time(&payload, 48.55).expect("faraway line exists");

    assert_eq!(first_refrain.text, "Johnny Boy, Johnny Boy");
    assert_eq!(first_refrain.translation, "Johnny小子，Johnny小子！");
    assert_eq!(storm_line.text, "we're bound for stormy weather");
    assert_eq!(storm_line.translation, "我们本就为风暴而生");
    assert_eq!(second_refrain.text, "Johnny Boy, Johnny Boy");
    assert_eq!(second_refrain.translation, "Johnny小子，Johnny小子！");
    assert_eq!(farewell_line.text, "better wish you lads farewell");
    assert_eq!(farewell_line.translation, "所有的祝福都给你");
    assert_eq!(faraway_line.text, "Somewhere out far away");
    assert_eq!(faraway_line.translation, "在某个遥远海域");
}

#[test]
fn keeps_short_english_lines_as_main_inside_japanese_romaji_lyrics() {
    let payload = build_structured_lyrics_payload(
        [
            "[01:14.957]<01:14.957>qi <01:15.107>yo <01:15.247>  <01:15.527>to <01:15.747>Wait! <01:16.287>Wait <01:16.637>yet! <01:17.137>",
            "[01:14.957]<01:14.957>ち<01:15.107>ょ<01:15.247>っ<01:15.527>と<01:15.747>Wait! <01:16.287>Wait <01:16.637>yet!<01:17.137>",
            "[01:14.957]<01:14.957>等一下 再等等<01:17.560>",
            "[01:17.567]<01:17.567>\"Believe <01:19.347>Be:leave\"<01:20.287>",
            "[01:17.567]<01:17.567>\"相信如此 离开吧\"<01:20.280>",
            "[01:21.517]<01:21.517>ma <01:21.947>da <01:22.157>yume <01:22.867>mi <01:23.067>te <01:23.247>yi <01:23.477>ta <01:23.697>n <01:23.917>da <01:24.417>",
            "[01:21.517]<01:21.517>ま<01:21.947>だ<01:22.157>夢<01:22.867>見<01:23.067>て<01:23.247>い<01:23.477>た<01:23.697>ん<01:23.917>だ<01:24.417>",
            "[01:21.517]<01:21.517>我是否还置身梦境中<01:24.650>",
            "[01:24.657]<01:24.657>So <01:24.867>I <01:25.317>dreamt?<01:26.047>",
            "[01:24.657]<01:24.657>所以这只是我的一场梦？<01:26.040>",
            "[01:39.956]<01:39.956>Still <01:40.196>I <01:40.516>believe?<01:41.345>",
            "[01:39.956]<01:39.956>我仍相信?<01:41.340>",
        ]
        .join("\n"),
    );
    let believe_line =
        find_display_line_by_time(&payload, 77.567).expect("short english line exists");
    assert_eq!(believe_line.text, "\"Believe Be:leave\"");
    assert_eq!(believe_line.translation, "\"相信如此 离开吧\"");
    assert!(believe_line.romaji.is_empty());

    let dreamt_line =
        find_display_line_by_time(&payload, 84.657).expect("short english question exists");
    assert_eq!(dreamt_line.text, "So I dreamt?");
    assert_eq!(dreamt_line.translation, "所以这只是我的一场梦？");
    assert!(dreamt_line.romaji.is_empty());

    let still_line =
        find_display_line_by_time(&payload, 99.956).expect("short english refrain exists");
    assert_eq!(still_line.text, "Still I believe?");
    assert_eq!(still_line.translation, "我仍相信?");
    assert!(still_line.romaji.is_empty());
}

#[test]
fn keeps_japanese_main_after_english_interlude_in_romaji_translation_lyrics() {
    let payload = build_structured_lyrics_payload(
        [
            "[00:00.000]<00:00.000>Avid - <00:00.150><00:00.151>SawanoHiroyuki[<00:00.301>nZk] <00:00.426>(<00:00.451><00:00.452>泽<00:00.602><00:00.603>野<00:00.753><00:00.754>弘<00:00.904>之<00:01.054><00:01.055>)/<00:01.205><00:01.206>瑞<00:01.507>葵<00:01.657><00:01.658> (<00:01.808>mizuki)<00:01.958>",
            "[00:00.000]<00:00.000>QQ音乐享有本翻译作品的著作权<00:01.950>",
            "[00:01.959]<00:01.959>词<00:02.109><00:02.110>：<00:02.260><00:02.261>cAnON.<00:02.411>",
            "[00:02.411]<00:02.411>曲<00:02.863>：<00:03.013><00:03.014>澤<00:03.315><00:03.316>野<00:03.466>弘<00:03.767><00:03.768>之<00:04.069>",
            "[00:04.069]<00:04.069>编<00:04.370>曲<00:04.822><00:04.823>：<00:04.973>澤<00:05.274><00:05.275>野<00:05.425>弘<00:05.726><00:05.727>之<00:06.028>",
            "[00:06.028]<00:06.028>Drums：<00:06.178><00:06.179>藤<00:06.480>崎<00:06.781><00:06.782>誠<00:07.083>人<00:07.233>",
            "[00:07.234]<00:07.234>Bass：<00:07.384><00:07.385>田<00:07.535>辺<00:07.836><00:07.837>ト<00:07.987>シ<00:08.137><00:08.138>ノ<00:08.288>",
            "[00:08.289]<00:08.289>Cello：<00:08.439><00:08.440>伊<00:08.590>藤<00:08.891><00:08.892>ハ<00:09.042>ル<00:09.192><00:09.193>ト<00:09.343><00:09.344>シ<00:09.494>",
            "[00:09.494]<00:09.494>Piano：<00:09.644><00:09.645>澤<00:09.946><00:09.947>野<00:10.097>弘<00:10.398><00:10.399>之<00:10.700>",
            "[00:10.700]<00:10.700>Recording & <00:10.850><00:10.851>Mix <00:11.001><00:11.002>Engineer：<00:11.152>相<00:11.453><00:11.454>澤<00:11.755>光<00:12.056>紀<00:12.357><00:12.358> (<00:12.456>SIGN <00:12.554>SOUND)<00:12.651>",
            "[00:12.651]<00:12.651>ka <00:12.884>yo <00:13.267>wa <00:13.476>i <00:13.678>hi <00:14.126>ka <00:14.543>ri <00:14.553>ga <00:14.897>yu <00:15.201>bi <00:15.616>sa <00:16.936>su <00:17.007>sa <00:17.599>ki <00:18.056>",
            "[00:12.651]<00:12.651>か<00:12.884>弱<00:13.476>い<00:13.678>光<00:14.553>が<00:14.897>指<00:15.616>差<00:16.936>す<00:17.007>先<00:18.056>",
            "[00:12.651]<00:12.651>追寻着那道微弱光线所指的方向<00:18.920>",
            "[00:30.710]<00:30.710>gi <00:31.168><00:31.169>ko <00:32.356>chi <00:32.653>na <00:33.236><00:33.237>i <00:33.949><00:33.950><00:33.950>innocent <00:35.933>calm <00:36.597>",
            "[00:30.710]<00:30.710>ぎ<00:31.169>こ<00:32.357>ち<00:32.654>な<00:33.238>い<00:33.950> <00:33.950>innocent <00:35.934>calm<00:36.598>",
            "[00:30.710]<00:30.710>小心翼翼地维护着这无辜的宁静<00:37.310>",
            "[00:37.311]<00:37.311>Close <00:37.607>my <00:38.007>eyes <00:38.375>and <00:38.815>figure <00:39.519>out <00:39.847>the <00:40.375>vacancy<00:42.696>",
            "[00:37.311]<00:37.311>我闭上眼睛 只觉空虚<00:43.310>",
            "[00:43.314]<00:43.314>I <00:43.420>don't <00:43.716>know <00:44.108>what <00:44.428>I <00:44.943>wanted <00:45.769>or <00:45.818>you <00:46.434>made <00:47.514>me <00:48.274>do<00:48.866>",
            "[00:43.314]<00:43.314>我不知自己心之所向 亦不知你对我期望怎样<00:49.280>",
            "[01:38.981]<01:38.981>tsu <01:39.033>ta <01:39.521><01:39.522>na <01:39.564><01:39.565>i <01:39.836>i <01:40.267><01:40.268>no <01:40.323><01:40.324>ri <01:40.620><01:40.621>ga <01:41.004>o <01:41.348>ri <01:41.877><01:41.878>na <01:42.802><01:42.803>su <01:43.315>na <01:43.731>mi <01:44.178>",
            "[01:38.981]<01:38.981>拙<01:39.565>い<01:39.837>祈<01:40.325>り<01:40.621>が<01:41.005>織<01:41.349>り<01:41.879>な<01:42.803>す<01:43.315>波<01:44.179>",
            "[01:38.981]<01:38.981>笨拙的祈愿交织而成汹涌的巨浪<01:45.140>",
            "[01:45.148]<01:45.148>Violent <01:45.706><01:45.707>maze <01:45.998>su <01:46.051>na <01:46.418>ni <01:46.897><01:46.898>ma <01:46.942><01:46.943>mi <01:47.280>re <01:47.548><01:47.549>u <01:47.915><01:47.916>ma <01:49.211>ru <01:49.295><01:49.296>a <01:49.817><01:49.818>shi <01:50.385>",
            "[01:45.148]<01:45.148>Violent <01:45.707>maze <01:45.998>砂<01:46.419>に<01:46.898>ま<01:46.943>み<01:47.281>れ<01:47.549>埋<01:47.916>ま<01:49.212>る<01:49.297>足<01:50.385>",
            "[01:45.148]<01:45.148>在暴力的世界迷失 双足在弥漫的风沙中埋葬<01:51.170>",
            "[01:51.178]<01:51.178>ko <01:51.377>ma <01:51.737>ku <01:51.789><01:51.790>ni <01:52.109><01:52.110>hi <01:52.573>bi <01:52.861>ku <01:53.069><01:53.069>in <01:53.313><01:53.314>tsu <01:53.428>u <01:53.542><01:53.543><01:53.657>ku <01:54.209>da <01:55.432><01:55.433>sa <01:55.649><01:55.650>re <01:56.208>ru <01:56.521>",
            "[01:51.178]<01:51.178>鼓<01:51.378>膜<01:51.790>に<01:52.110>響<01:52.862>く<01:53.070> <01:53.070>in<01:53.314>2<01:53.543> <01:53.657><01:53.658>下<01:55.434>さ<01:55.650>れ<01:56.209>る<01:56.522>",
            "[01:51.178]<01:51.178>不绝于耳 不断赋予我身的<01:56.940>",
            "[01:56.943]<01:56.943>to <01:57.430>me <01:58.615><01:58.616>do <01:58.830><01:58.831>na <01:59.462>i <02:00.134><02:00.135><02:00.135>resonant <02:02.065><02:02.066>harm <02:02.689>",
            "[01:56.943]<01:56.943>と<01:57.431>め<01:58.617>ど<01:58.831>な<01:59.463>い<02:00.135> <02:00.135>resonant <02:02.066>harm<02:02.689>",
            "[01:56.943]<01:56.943>是那从不曾间断的杀戮之音<02:03.500>",
        ]
        .join("\n"),
    );

    let innocent_line =
        find_display_line_by_time(&payload, 30.710).expect("mixed innocent calm line exists");
    assert_eq!(innocent_line.text, "ぎこちない innocent calm");
    assert_eq!(innocent_line.romaji, "gi ko chi na i innocent calm");
    assert_eq!(innocent_line.translation, "小心翼翼地维护着这无辜的宁静");
    assert_eq!(
        innocent_line
            .romaji_words
            .as_ref()
            .expect("innocent calm has independent romaji words")[0]
            .text,
        "gi "
    );

    let line = find_display_line_by_time(&payload, 98.981).expect("japanese line exists");
    assert_eq!(line.text, "拙い祈りが織りなす波");
    assert_eq!(line.romaji, "tsu ta na i i no ri ga o ri na su na mi");
    assert_eq!(line.translation, "笨拙的祈愿交织而成汹涌的巨浪");

    let json = serde_json::to_value(&payload).expect("payload serializes");
    let json_line = json["displayLines"]
        .as_array()
        .expect("display lines are serialized")
        .iter()
        .find(|line| {
            line["time"]
                .as_f64()
                .map(|time| (time - 98.981).abs() < 0.001)
                .unwrap_or(false)
        })
        .expect("serialized japanese line exists");
    let romaji_words = json_line["romajiWords"]
        .as_array()
        .expect("romaji words are serialized");
    assert_eq!(romaji_words[0]["text"], "tsu ");
    assert_eq!(romaji_words[0]["start"], 98.981);
    assert_eq!(romaji_words[0]["end"], 99.033);

    let mixed_line =
        find_display_line_by_time(&payload, 116.943).expect("mixed japanese line exists");
    assert_eq!(mixed_line.text, "とめどない resonant harm");
    assert_eq!(mixed_line.romaji, "to me do na i resonant harm");
    assert_eq!(mixed_line.translation, "是那从不曾间断的杀戮之音");
}
