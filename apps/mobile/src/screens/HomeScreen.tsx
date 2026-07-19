import { Camera, CloudRain, Coffee, HandHeart, Moon, Sparkles } from "lucide-react-native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SoftButton } from "../components/SoftButton";
import { colors } from "../theme/theme";

const entries = [
  { label: "哄哄我", prompt: "你可以哄哄我嗎？", icon: HandHeart },
  { label: "我有點不安", prompt: "我有點不安，但我不知道怎麼說。", icon: CloudRain },
  { label: "我想哭一下", prompt: "我想哭一下，你可以陪我嗎？", icon: Moon },
  { label: "陪我整理今天", prompt: "可以陪我整理今天發生的事嗎？", icon: Coffee },
  { label: "我想給你看一張圖", prompt: "我想傳一張圖給你看，陪我看看。", icon: Camera },
  { label: "隨便陪我聊聊", prompt: "我不知道要說什麼，但想有人陪我一下。", icon: Sparkles }
];

type Props = {
  onStart: (prompt: string) => void;
};

export function HomeScreen({ onStart }: Props) {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>今天想怎麼被陪？</Text>
        <Text style={styles.title}>先不用懂事，也不用把話說漂亮。</Text>
        <Text style={styles.body}>選一個比較接近現在的入口。進去之後，你可以慢慢改、慢慢說。</Text>
      </View>
      <View style={styles.grid}>
        {entries.map((entry) => (
          <SoftButton
            key={entry.label}
            label={entry.label}
            icon={entry.icon}
            tone="quiet"
            onPress={() => onStart(entry.prompt)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg
  },
  content: {
    padding: 20,
    gap: 24
  },
  hero: {
    gap: 10,
    paddingTop: 16
  },
  kicker: {
    color: colors.accentDark,
    fontWeight: "800",
    fontSize: 15
  },
  title: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 30,
    lineHeight: 38
  },
  body: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24
  },
  grid: {
    gap: 12
  }
});

