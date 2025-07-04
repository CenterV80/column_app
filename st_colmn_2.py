#cd 'C:\Users\nakas\OneDrive\ドキュメント\PytonScript\code\streamlit_app'    
#streamlit run st_colmn_2.py
#git remote set-url origin https://github.com/CenterV80/column-app.git
import streamlit as st
import pandas as pd
#

class ColmnApp:
    def __init__(self):
        if 'column_note' not in st.session_state:#st.session_stateの格納のされ方が辞書型
            st.session_state['column_note'] = []
        #print(type(st.session_state.column_note))
        
    def input_ui(self):
        with st.form("my_form", clear_on_submit=True):
            st.markdown("### 📝 コラム記録")
            event = st.text_input("出来事", placeholder="例: リーダーから外れた")
            auto_think = st.text_input("考え（自動思考）", placeholder="例: 自分は駄目人間だ")

            emotions = ['不安','怒り','恥','罪悪感','悲しい','困惑','興奮','おびえ','いらいら','心配',
                        'パニック','不満','うんざり','傷ついた','失望','怖い','屈辱感']

            col1, col2, col3, col4 = st.columns(4)
            with col1:
                emo1 = st.selectbox("感情1", emotions)
            with col2:
                val1 = st.slider("強さ1", 0, 100, 50)
            with col3:
                emo2 = st.selectbox("感情2", emotions)
            with col4:
                val2 = st.slider("強さ2", 0, 100, 50)

            col5, col6 = st.columns(2)
            with col5:
                basis = st.text_area("根拠", placeholder="「〇〇」と言われた")
            with col6:
                refute = st.text_area("反証", placeholder="過去の経験から...")

            balanced = st.text_area("バランスの良い考え", placeholder="しかし〜")

            if st.form_submit_button("＋ コラムを追加"):
                if event.strip():
                    entry = {
                        "出来事": event,
                        "考え(自動思考)": auto_think,
                        emo1: val1,
                        emo2: val2,
                        "根拠": basis,
                        "反証": refute,
                        "バランスの良い考え": balanced
                    }
                    st.session_state.column_note.append(entry)
                else:
                    st.warning("⚠️ 『出来事』は必須です。")
                    
    def make_display(self):
        deleate_index = None
        
        if 'column_note' in st.session_state:
            for idx, note in enumerate(st.session_state.column_note):
                with st.expander(note.get("出来事", f"コラム{idx+1}")):
                    for key, val in note.items():
                        st.write(f"**{key}**: {val}")
                    if st.button("削除", key=f"del_{idx}"):
                        deleate_index = idx      
        if deleate_index is not None:
            st.session_state.column_note.pop(deleate_index)
            #↑column_noteは[{"出来事": event,emo1: val1}]のようにリストの中に辞書型で入っている。
            #.pop(deleate_index)で整数番目のリストを削除する
            
            st.rerun()
        
        # ダウンロードボタン
        df = pd.DataFrame(st.session_state.column_note)
        json_data = df.to_json(#JSON文字列に変換しています。
            orient='records',#各行が1つの dict として出力されます
            force_ascii=False#-指定することで、日本語などの非ASCII文字がそのまま残るようになります
        )
        
        print(json_data)
        st.download_button(
            label='jsonで保存',# ボタン表示ラベル
            data=json_data,# 保存対象データ（文字列 or バイナリ）
            file_name='data.json',# ダウンロードされるファイル名
            mime="application/json"# MIMEタイプ（データの種類）
        )

def main():
    app = ColmnApp()
    app.input_ui()
    app.make_display()


if __name__ == '__main__':
    main()