import { useCallback, useEffect, useRef } from "react";
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent
} from "react-native";

type Options = {
  active: boolean;
  itemCount: number;
  resetKey: string;
};

export function useInitialScrollToLatest<Item>({
  active,
  itemCount,
  resetKey
}: Options) {
  const listRef = useRef<FlatList<Item>>(null);
  const followLatestRef = useRef(true);
  const userHasDraggedRef = useRef(false);
  const activeRef = useRef(active);
  const itemCountRef = useRef(itemCount);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);

  activeRef.current = active;
  itemCountRef.current = itemCount;

  const resetInitialScroll = useCallback(() => {
    userHasDraggedRef.current = false;
    followLatestRef.current = true;
  }, []);

  const correctToBottom = useCallback(() => {
    if (!activeRef.current || !followLatestRef.current || itemCountRef.current === 0) return;

    const offset = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
    listRef.current?.scrollToOffset({ offset, animated: false });
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeightRef.current = height;
    correctToBottom();
  }, [correctToBottom]);

  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeightRef.current = event.nativeEvent.layout.height;
    correctToBottom();
  }, [correctToBottom]);

  const onLastItemLayout = useCallback(() => {
    correctToBottom();
  }, [correctToBottom]);

  const onScrollBeginDrag = useCallback(() => {
    userHasDraggedRef.current = true;
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!userHasDraggedRef.current) return;

    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    followLatestRef.current = distanceFromBottom <= 40;
  }, []);

  useEffect(() => {
    resetInitialScroll();
  }, [resetInitialScroll, resetKey]);

  useEffect(() => {
    if (active) correctToBottom();
  }, [active, correctToBottom]);

  useEffect(() => {
    correctToBottom();
  }, [correctToBottom, itemCount]);

  return {
    listRef,
    onContentSizeChange,
    onListLayout,
    onLastItemLayout,
    onScrollBeginDrag,
    onScroll,
    resetInitialScroll,
  };
}
