#cd 'C:\Users\nakas\OneDrive\ドキュメント\PytonScript\code\streamlit_app'    
#streamlit run st_colmn.py
#git remote set-url origin https://github.com/CenterV80/column-app.git
import streamlit as st

class ColmnApp:
    def __init__(self):
        if 'colmun_note' not in st.session_state:
            st.session_state.colmun_note = []
            
        self.emotions_list = ['不安','怒り','恥','罪悪感','悲しい','困惑','興奮','おびえ','いらいら','心配','パニック','不満','うんざり','傷ついた','失望','怖い','屈辱感']
    
    def input_ui(self):
        with st.form("my_form", clear_on_submit=True):
            st.markdown('**コラム法**')
            self.event = st.text_input('出来事',key='dekigoto',placeholder='例:リーダーから外れた')
            self.auto_think = st.text_input('考え(自動思考)',key='kangae',placeholder='例:自分は駄目人間だ')
            
            col1,col2,col3,col4, = st.columns(4)
            with col1:
                self.col1 = st.selectbox(label='感情', options=[f'{i}'for i in self.emotions_list],key=1)
            with col2:
                self.col2 = st.slider('',0,100,50,key=2)
            with col3:
                self.col3 = st.selectbox(label='感情', options=[f'{i}'for i in self.emotions_list],key=3)
            with col4:
                self.col4 = st.slider('',0,100,50,key=4)
                
            col5,col6 = st.columns(2)
            with col5:
                self.basis = st.text_area('根拠',key='konkyo',placeholder='「」と言われた')
            with col6:
                self.Refutation = st.text_area('反証',key='hansho'
                                               ,placeholder='過去の経験から')
            
            self.goodthink = st.text_area('バランスの良い考え',key='good_think',
                                          placeholder='しかし～')
            
            
            self.submitted = st.form_submit_button("コラムを追加")
            
        if self.submitted:
            if self.event and self.event:
                colmns ={
                    '出来事':self.event,
                    '考え(自動思考)':self.auto_think,
                    self.col1:self.col2,
                    self.col3:self.col4,
                    '根拠':self.basis,
                    '反証':self.Refutation,
                    'バランスの良い考え':self.goodthink
                    }
                
                st.session_state.colmun_note.append(colmns)
            else:st.info('テキストを入力してください')
   
        
        
    def make_display(self):
        delete_index = None
        
        for idx,note in enumerate(st.session_state.colmun_note):
            with st.expander(note.get("出来事", f"コラム{idx+1}")):
                for key,val in note.items():
                    st.write(f'**{key}**:{val}')
                if st.button('削除',key=f'delete_{idx}'):
                    delete_index = idx
    
        if delete_index is not None:
            st.session_state.colmun_note.pop(delete_index)
            st.rerun()
def main():    
    app =  ColmnApp()
    app.input_ui()
    app.make_display()
    
if __name__ == '__main__':
    main()