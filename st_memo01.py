#streamlit run st_memo01.py

import streamlit as st

class AppMemo:
    def __init__(self):
        if 'memo_list' not in st.session_state:
            st.session_state.memo_list = {}

        if 'delete_key' not in st.session_state:
            st.session_state.delete_key = None  # 削除対象を管理

    def input_ui(self):
        memo_title = st.text_input('タイトルを入力してください', key='title_input')
        memo_text = st.text_area('メモを入力してください', key='text_input')

        if st.button("保存"):
            if memo_title and memo_text:
                st.session_state.memo_list[memo_title] = memo_text
                st.success("メモを保存しました！")

    def make_display(self):
        st.write("### 保存されたメモ")

        delete_target = None

        for title, text in list(st.session_state.memo_list.items()):
            st.write(f'#### {title}\n{text}')
            if st.button('削除', key=f'delete_{title}'):
                delete_target = title

        # ループが終わった後に安全に削除と再描画
        if delete_target:
            del st.session_state.memo_list[delete_target]
            st.rerun()


def main():
    st.title('メモアプリ')
    app = AppMemo()
    app.input_ui()
    app.make_display()

if __name__ == '__main__':
    main()