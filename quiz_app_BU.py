#streamlit run streamlit_app/quiz_app.py
#streamlit run quiz_app.py

import streamlit as st
import csv
import os

class AppQuize:
    def __init__(self):
        
        self.quenssions = self.load_quession()
        print(self.quenssions)
            
    def load_quession(self):
        dir_name = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(dir_name,'quize.csv')
        quessions=[]
        with open(file_path,encoding='utf-8-sig')as csvfile:
            csv_read=csv.reader(csvfile)
            for row in csv_read:
                if any(call.strip() for call in row):
                    quessions.append(row)
        return quessions 
    def make_display(self):
        self.user_anser = []
        st.title('クイズアプリ')
        upload_file =st.file_uploader('csvファイルを選択してね',type='csv')#ブラウザでcsvデータの読み込み
        print(type(upload_file))
        
        for i,q in enumerate(self.quenssions):
            st.subheader(f'{i+1}問目:{q[0]}')
            option = q[1:5]#スライス　列　
            correct_index = int(q[5])-1#答えのint 0～3に変形  
            selected=st.radio('答えを選択して',option,key=f'quession_{i}')#st.radioの戻り値は選択しているint値
            
            self.user_anser.append((selected,option[correct_index]))#タプルで追加していく
            
        print(self.user_anser)
        #self.judge()
    def judge(self):
        total = len(self.quenssions)
        correct =sum(1 for sel,ans in self.user_anser if sel == ans)#sum(ジェネレータ式)だと毎ループごとに足し算される
        print(correct)
        if total == correct:
            st.success('全問正解です')
        else:
            st.info(f"{correct}問正解です: {total}問中")
            
def main():
    app =AppQuize()
    app.make_display()
    
    if st.button('答え合わせ'):#ボタンが押されたらTrueを返す
        app.judge()
              
if __name__ ==  '__main__':
    main()