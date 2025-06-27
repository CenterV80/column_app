#streamlit run streamlit_app/quiz_app.py
#streamlit run quiz_app.py

import streamlit as st
import io
import csv

class AppQuize:
    def __init__(self):
        self.quenssions = []
        self.user_anser = []

    def load_quession(self):
        upload_file =st.file_uploader('csvファイルを選択してね',type='csv')#ブラウザでcsvデータの読み込み
        
        if upload_file:
            text = io.StringIO(upload_file.getvalue().decode('utf-8-sig').strip())
            csv_data = csv.reader(text)
            if upload_file:
                for row  in csv_data:
                    if any(cell.strip() for cell in row):
                        self.quenssions.append(row)
                return True
                                    

        return False
    def make_display(self):
        st.title('クイズアプリ')
        
        
        for i, q in enumerate(self.quenssions):
            st.subheader(f'{i+1}問目:{q[0]}')
            option = q[1:5]
            anser_index = int(q[5])-1
            selected = st.radio('答えを選択して',option,key=f'quession_{i}')
            self.user_anser.append((selected,option[anser_index]))
    
    def judge(self):
        pass

def main():
    app=AppQuize()
    if app.load_quession():
        app.make_display()
        if st.button('答え合わせ'):
            app.judge()
    else:
        st.info('zzz')
        
        

if __name__ == '__main__':
    main()

